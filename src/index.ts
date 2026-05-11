import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isGitRepo, getRepoRoot } from "./git.js";
import { whoTouched } from "./who-touched.js";
import { introducingPR } from "./introducing-pr.js";
import { coChange } from "./co-change.js";
import { branchHygiene } from "./branch-hygiene.js";
import { recentWork } from "./recent-work.js";
import { commitContext } from "./commit-context.js";
import { getOctokit } from "./github.js";

const server = new Server(
  { name: "git-insight-mcp", version: "0.1.3" },
  { capabilities: { tools: {} } }
);

// Every tool here is read-only: it shells out to `git` (and optionally the
// GitHub REST API) and never mutates the working tree, index, or remote.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;
const LOCAL_ONLY = { ...READ_ONLY, openWorldHint: false } as const;
const MAY_HIT_GITHUB = { ...READ_ONLY, openWorldHint: true } as const;

const TOOLS = [
  {
    name: "who_touched",
    description:
      "Read-only. Code ownership for a file via `git blame`, aggregated by author. " +
      "Returns each author's line count, commit count, and most recent commit date, plus the `primary_owner` (most lines). " +
      "Pass `line_start`/`line_end` to scope to one region (e.g. a single function). " +
      "Errors if `cwd` is not a git repo or `file` is untracked. Cost scales with file size; instant for typical files.",
    annotations: { title: "Who touched this file", ...LOCAL_ONLY },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        file: { type: "string", description: "File path relative to the repo root, e.g. `src/auth.ts`." },
        line_start: { type: "number", description: "Optional 1-based start line. Must be paired with `line_end` to take effect." },
        line_end: { type: "number", description: "Optional 1-based end line (inclusive). Must be paired with `line_start`." },
        function: { type: "string", description: "Optional label echoed back in the result; cosmetic only, does not change the blame range." },
      },
      required: ["file"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        total_lines: { type: "number" },
        authors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              lines: { type: "number" },
              commits: { type: "number" },
              last_commit_date: { type: "string", description: "ISO 8601 timestamp of the author's most recent commit to this range." },
            },
          },
        },
        primary_owner: { type: "string", description: "Name of the author with the most lines." },
      },
    },
  },
  {
    name: "introducing_pr",
    description:
      "Read-only. Find the pull request that introduced a line or a commit. " +
      "First resolves the line to a commit via `git blame`, then reads the local merge-commit message; " +
      "if that has no PR reference and `GH_TOKEN`/`GITHUB_TOKEN` is set, falls back to the GitHub REST API. " +
      "Without a token the local path still works; `pr` is `null` when nothing can be resolved (e.g. rebase-merged with no PR ref). " +
      "Provide either `commit`, or both `file` and `line`. May make one outbound GitHub API call (subject to the 5000/h authed rate limit).",
    annotations: { title: "Introducing PR", ...MAY_HIT_GITHUB },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        file: { type: "string", description: "File path relative to the repo root. Requires `line`." },
        line: { type: "number", description: "1-based line number in `file` to blame back to its introducing commit." },
        commit: { type: "string", description: "Commit SHA to look up directly. Use this instead of `file`/`line`." },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        commit: { type: "string" },
        commit_message: { type: "string" },
        commit_date: { type: "string" },
        author: { type: "string" },
        source: { type: "string", description: "How the PR was resolved: `merge-message`, `github-api`, or `not-found`." },
        pr: { type: ["object", "null"], description: "PR details when resolved, else null." },
      },
    },
  },
  {
    name: "co_change",
    description:
      "Read-only. Files that historically change together with the input file — answers \"if I edit X, what else should I check?\". " +
      "Mines up to `window` recent commits that touch `file`, counts how often each other file appears alongside it, and returns those above `threshold`, " +
      "with the co-occurrence count and ratio (count / commits-touching-file), capped at `limit`. " +
      "Pure local log mining; no network. Cost is O(window × files-per-commit) — keep `window` ≤ a few thousand on large repos.",
    annotations: { title: "Co-change suggestions", ...LOCAL_ONLY },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        file: { type: "string", description: "File path relative to the repo root to find co-changing files for." },
        window: { type: "number", description: "How many recent commits touching `file` to mine. Default 1000." },
        threshold: { type: "number", description: "Minimum co-occurrence count for a file to be included. Default 3." },
        limit: { type: "number", description: "Maximum number of co-changing files to return, highest count first. Default 20." },
      },
      required: ["file"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "string" },
        total_commits_touching: { type: "number" },
        co_changed: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              count: { type: "number" },
              ratio: { type: "number", description: "count / total_commits_touching, 0–1." },
            },
          },
        },
      },
    },
  },
  {
    name: "branch_hygiene",
    description:
      "Read-only. Inventory of branches with ahead/behind counts versus the default branch, last commit date and author, merged status, and a `stale` flag " +
      "(no commits in `stale_days` days). Use it to find unmerged, abandoned branches. The default branch itself is excluded from the list. " +
      "Pure local git; no network. Returns `{ count, branches, default_branch_excluded }`.",
    annotations: { title: "Branch hygiene", ...LOCAL_ONLY },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        stale_days: { type: "number", description: "A branch with no commit newer than this many days is flagged `stale`. Default 30." },
        remote: { type: "boolean", description: "Inspect remote (`origin`) branches instead of local branches. Default false." },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number" },
        default_branch_excluded: { type: "boolean" },
        branches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              ahead: { type: "number" },
              behind: { type: "number" },
              last_commit_date: { type: "string" },
              last_commit_author: { type: "string" },
              merged: { type: "boolean" },
              stale: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  {
    name: "recent_work",
    description:
      "Read-only. Standup / changelog helper: one author's commits in a time window with files touched and insertion/deletion totals. " +
      "Defaults to the repo's `user.name` and the last 7 days. Pure local git; no network. " +
      "Returns `{ author, since, commit_count, commits[] }` where each commit has subject, date, files, insertions, deletions.",
    annotations: { title: "Recent work", ...LOCAL_ONLY },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        author: { type: "string", description: "Author name or email substring (passed to `git log --author`). Defaults to `git config user.name`." },
        since: { type: "string", description: "Any git date expression, e.g. `7 days ago`, `2026-05-01`, `last monday`. Default `7 days ago`." },
        limit: { type: "number", description: "Maximum number of commits to return, newest first. Default 100." },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        author: { type: "string" },
        since: { type: "string" },
        commit_count: { type: "number" },
        commits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sha: { type: "string" },
              subject: { type: "string" },
              date: { type: "string" },
              files: { type: "number" },
              insertions: { type: "number" },
              deletions: { type: "number" },
            },
          },
        },
      },
    },
  },
  {
    name: "commit_context",
    description:
      "Read-only. Everything about one commit in a single call: subject, body, changed files with per-file insertions/deletions, totals, " +
      "the linked PR (parsed from the merge message, or via the GitHub API when `GH_TOKEN`/`GITHUB_TOKEN` is set), and issue numbers referenced in the message (`Fixes #N`, `Closes #N`). " +
      "Errors if the SHA does not resolve in `cwd`. May make one outbound GitHub API call for PR enrichment.",
    annotations: { title: "Commit context", ...MAY_HIT_GITHUB },
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Path inside the target git repo. Defaults to the server's current working directory." },
        sha: { type: "string", description: "Commit SHA (full or abbreviated) or any revision `git` accepts, e.g. `HEAD`, `HEAD~3`, a tag." },
      },
      required: ["sha"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        sha: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        author: { type: "string" },
        date: { type: "string" },
        files_changed: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, insertions: { type: "number" }, deletions: { type: "number" } },
          },
        },
        insertions: { type: "number" },
        deletions: { type: "number" },
        pr: { type: ["object", "null"] },
        related_issues: { type: "array", items: { type: "number" } },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const Cwd = z.string().optional();

async function resolveCwd(input?: string): Promise<string> {
  const candidate = input ?? process.cwd();
  if (!(await isGitRepo(candidate))) {
    throw new Error(`Not a git repository: ${candidate}`);
  }
  return await getRepoRoot(candidate);
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a: any = args ?? {};
  try {
    const cwd = await resolveCwd(Cwd.parse(a.cwd));
    switch (name) {
      case "who_touched": {
        const file = z.string().parse(a.file);
        const lineRange =
          a.line_start && a.line_end ? ([Number(a.line_start), Number(a.line_end)] as [number, number]) : undefined;
        const result = await whoTouched({ cwd, file, lineRange, function: a.function });
        return ok(result);
      }
      case "introducing_pr": {
        if (!a.commit && !(a.file && a.line)) throw new Error("Provide commit OR (file + line)");
        const result = await introducingPR({
          cwd,
          file: a.file,
          line: a.line ? Number(a.line) : undefined,
          commit: a.commit,
        });
        return ok(result);
      }
      case "co_change": {
        const file = z.string().parse(a.file);
        const result = await coChange({
          cwd,
          file,
          window: a.window ? Number(a.window) : undefined,
          threshold: a.threshold ? Number(a.threshold) : undefined,
          limit: a.limit ? Number(a.limit) : undefined,
        });
        return ok(result);
      }
      case "branch_hygiene": {
        const result = await branchHygiene({
          cwd,
          staleDays: a.stale_days ? Number(a.stale_days) : undefined,
          remote: Boolean(a.remote),
        });
        return ok({ count: result.length, branches: result, default_branch_excluded: true });
      }
      case "recent_work": {
        const result = await recentWork({
          cwd,
          author: a.author,
          since: a.since,
          limit: a.limit ? Number(a.limit) : undefined,
        });
        return ok(result);
      }
      case "commit_context": {
        const sha = z.string().parse(a.sha);
        const result = await commitContext({ cwd, sha });
        return ok(result);
      }
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
});

function ok(data: unknown) {
  const meta = getOctokit() ? "" : "\n[note: GH_TOKEN/GITHUB_TOKEN not set — PR/issue lookups disabled]";
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + meta }],
    structuredContent: data as Record<string, unknown>,
  };
}
function err(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);

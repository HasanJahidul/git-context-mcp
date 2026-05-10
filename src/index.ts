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
  { name: "git-insight-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "who_touched",
    description: "Walk git blame and group authorship by author. Returns line counts, commit counts, last-touched date, and primary owner. Optionally narrow by line range.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repo path. Defaults to current working dir." },
        file: { type: "string", description: "Path to file (relative to repo root)" },
        line_start: { type: "number" },
        line_end: { type: "number" },
        function: { type: "string", description: "Optional function name label (cosmetic)" },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "introducing_pr",
    description: "Find the PR that introduced a line or commit. Walks blame -> commit -> parses merge message OR queries GitHub API. Requires GH_TOKEN for API fallback.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        file: { type: "string" },
        line: { type: "number" },
        commit: { type: "string", description: "SHA (optional alternative to file/line)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "co_change",
    description: "Files most often changed together with the input file across recent commits. Useful for 'edit X, also check Y' suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        file: { type: "string" },
        window: { type: "number", description: "How many recent commits touching the file to mine (default 1000)" },
        threshold: { type: "number", description: "Min co-occurrence count (default 3)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["file"],
      additionalProperties: false,
    },
  },
  {
    name: "branch_hygiene",
    description: "List branches with ahead/behind vs default branch, last commit date/author, merged status, and stale flag.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        stale_days: { type: "number", description: "Days without commit to count as stale (default 30)" },
        remote: { type: "boolean", description: "Inspect remote (origin) branches instead of local (default false)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "recent_work",
    description: "Standup helper. Author's commits + files touched + insertions/deletions in a time window.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        author: { type: "string", description: "Defaults to git config user.name" },
        since: { type: "string", description: "Git date expression (default '7 days ago')" },
        limit: { type: "number", description: "Max commits to return (default 100)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "commit_context",
    description: "Full context for a commit: subject, body, files changed, insertions/deletions, linked PR, related issues parsed from the message.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        sha: { type: "string" },
      },
      required: ["sha"],
      additionalProperties: false,
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
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + meta }] };
}
function err(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);

# git-context-mcp — Project Context

MCP server for semantic git queries. Walks `git` CLI + Octokit. Local + GitHub-aware.
Sibling to terminal-history-mcp + localhost-mcp (same author, same TS+npm pattern).

## Status

- **Version**: 0.1.0 scaffold (initial)
- **Working dir**: `/Users/jahidulhasan/Documents/research/mcp-servers/git-context-mcp`
- **Wire**: `claude mcp add --scope user git-context -- git-context-mcp` (after `npm link`)
- **GH auth**: `GH_TOKEN` or `GITHUB_TOKEN` env. Without, PR/issue lookups skipped (local-only mode still works).

## Architecture

```
src/
├── cli.ts              Bin entry. Subcommands: server | who-touched | co-change | branches | recent | commit | intro-pr | --version | --help.
├── index.ts            MCP stdio server. Registers 6 tools. resolveCwd() rejects non-git dirs.
├── git.ts              git CLI wrapper (execFile). isGitRepo, getRepoRoot, defaultBranch, gitOriginUrl, parseRemoteUrl, blameFile (porcelain parser).
├── github.ts           Octokit factory (lazy, env-driven). fetchPRForCommit, parsePRNumberFromMessage, parseIssuesFromMessage.
├── who-touched.ts      Aggregate blame lines by author -> AuthorOwnership[] sorted by line count.
├── introducing-pr.ts   blame -> commit -> parse merge msg OR API listPullRequestsAssociatedWithCommit.
├── co-change.ts        For each commit touching file, count co-occurring files. Threshold + ratio + limit.
├── branch-hygiene.ts   for-each-ref + rev-list --left-right --count for ahead/behind. --merged for merged status. stale = >N days no commit.
├── recent-work.ts      git log --author --since + numstat aggregation.
├── commit-context.ts   git show --no-patch + --numstat. Parse Fixes #N. PR via merge-msg or API.
├── types.ts            Shared shapes (WhoTouchedResult, PRRef, CoChangeEntry, BranchInfo, RecentWorkResult, CommitContextResult).
└── test/               node:test suites (added as tools harden).
```

## MCP Tools

| Tool | Required GH? | Notes |
|------|-------------|-------|
| `who_touched` | No | Pure blame |
| `introducing_pr` | Optional | Local merge-msg parse first, API fallback |
| `co_change` | No | Pure log mining |
| `branch_hygiene` | No | for-each-ref + rev-list |
| `recent_work` | No | log + numstat |
| `commit_context` | Optional | show + PR/issue parse |

When GH_TOKEN absent, every response carries a one-line note so callers know PR fields will be `null`.

## Tech Decisions

- **Shell out to `git` binary** — no libgit2 / nodegit. Matches what users already have. Zero native deps for git ops.
- **Better-sqlite3 in deps** — reserved for v0.2 co-change cache. Not used in v0.1 (each call re-mines). Acceptable up to 1000 commits.
- **Octokit lazy** — instantiated on first call when token present. No-token mode is a first-class path.
- **resolveCwd() centralizes** the "is git repo?" check so every tool refuses gracefully on non-repo dirs.
- **Porcelain blame parser** — `--porcelain` is the only stable, parseable blame format. Hand-rolled parser; no external dep.
- **No license-gate** in v0.1. Free and unlimited.

## Build / Run

```bash
npm install
npm run build              # tsc -> dist/
npm run start              # MCP stdio server
node dist/cli.js branches  # CLI sanity
```

## Test Commands (manual, post-build)

```bash
# stdio sanity
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js | head -c 800

# walk own repo
node dist/cli.js who-touched src/git.ts
node dist/cli.js recent
```

## v0.1 Known Limits

- GitHub only (no GitLab/Bitbucket).
- No co-change SQLite cache yet — every call re-mines.
- Function blame by line range, not AST. No rename tracking.
- GH API rate-limit (5000/h authed) shared across all calls; no in-process cache.
- Squash-merge PR linkage relies on merge-message regex OR API search. Rebase-merged commits w/ no PR ref in body return `pr: null`.

## Roadmap (v0.2+)

1. SQLite cache for `co_change` (rebuild on demand).
2. PR cache (24h TTL).
3. Tree-sitter for function-level blame across renames (`function_history`).
4. `risky_change_detect` heuristic from co-change spread.
5. `expert_finder` (owner across files in a directory).
6. GitLab + Bitbucket adapters.
7. License-gate (Pro/Team) — see strategy doc.

## Repo Conventions

- TS strict. ESM (`"type": "module"`). Node 18+.
- No emoji in code/commits.
- No Co-Authored-By trailer in any commit (per global feedback memory).
- Match terminal-history-mcp + localhost-mcp file layout for muscle memory.
- No comments unless WHY is non-obvious.

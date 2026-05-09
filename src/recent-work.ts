import { git } from "./git.js";
import { parsePRNumberFromMessage } from "./github.js";
import type { RecentWorkResult } from "./types.js";

export async function recentWork(opts: {
  cwd: string;
  author?: string;
  since?: string;
  limit?: number;
}): Promise<RecentWorkResult> {
  const since = opts.since ?? "7 days ago";
  const limit = opts.limit ?? 100;

  let author = opts.author;
  if (!author) {
    try {
      author = (await git(["config", "user.name"], opts.cwd)).trim();
    } catch {
      author = "";
    }
  }

  const args = ["log", `--author=${author}`, `--since=${since}`, "-n", String(limit), "--pretty=format:%H|%aI|%s"];
  const logOut = await git(args, opts.cwd);
  const commits = logOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...rest] = line.split("|");
      const subject = rest.join("|");
      const pr = parsePRNumberFromMessage(subject);
      return { sha, date, subject, pr: pr ?? undefined };
    });

  let insertions = 0;
  let deletions = 0;
  const filesSet = new Set<string>();

  if (commits.length) {
    const shortStat = await git(
      ["log", `--author=${author}`, `--since=${since}`, "--pretty=format:", "--numstat"],
      opts.cwd
    );
    for (const line of shortStat.split("\n")) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const ins = m[1] === "-" ? 0 : parseInt(m[1], 10);
      const del = m[2] === "-" ? 0 : parseInt(m[2], 10);
      insertions += ins;
      deletions += del;
      filesSet.add(m[3]);
    }
  }

  return {
    author,
    since,
    commit_count: commits.length,
    files_touched: filesSet.size,
    insertions,
    deletions,
    commits,
  };
}

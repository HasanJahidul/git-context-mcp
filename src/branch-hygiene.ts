import { git, defaultBranch } from "./git.js";
import type { BranchInfo } from "./types.js";

export async function branchHygiene(opts: {
  cwd: string;
  staleDays?: number;
  remote?: boolean;
}): Promise<BranchInfo[]> {
  const staleDays = opts.staleDays ?? 30;
  const main = await defaultBranch(opts.cwd);
  const refPrefix = opts.remote ? "refs/remotes/origin/" : "refs/heads/";

  const out = await git(
    ["for-each-ref", "--format=%(refname:short)|%(committerdate:iso8601)|%(authorname)", refPrefix],
    opts.cwd
  );

  const branches: BranchInfo[] = [];
  const now = Date.now();
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, dateStr, author] = line.split("|");
    if (!name) continue;
    if (name === main || name === `origin/${main}` || name === "origin/HEAD") continue;

    const baseRef = opts.remote ? `origin/${main}` : main;
    let ahead = 0;
    let behind = 0;
    try {
      const counts = await git(["rev-list", "--left-right", "--count", `${baseRef}...${name}`], opts.cwd);
      const [b, a] = counts.trim().split("\t").map((n) => parseInt(n, 10) || 0);
      ahead = a;
      behind = b;
    } catch {}

    let merged = false;
    try {
      const mergedOut = await git(["branch", "--merged", baseRef], opts.cwd);
      merged = mergedOut.split("\n").some((l) => l.replace(/^[* ]+/, "").trim() === name.replace(/^origin\//, ""));
    } catch {}

    const last = new Date(dateStr).getTime();
    const stale = !isNaN(last) && now - last > staleDays * 86400000;

    branches.push({
      name,
      ahead,
      behind,
      last_commit_date: dateStr,
      last_commit_author: author ?? "",
      merged,
      stale,
    });
  }

  return branches.sort((a, b) => (a.last_commit_date > b.last_commit_date ? -1 : 1));
}

import { git } from "./git.js";
import type { CoChangeResult, CoChangeEntry } from "./types.js";

export async function coChange(opts: {
  cwd: string;
  file: string;
  window?: number;
  threshold?: number;
  limit?: number;
}): Promise<CoChangeResult> {
  const window = opts.window ?? 1000;
  const threshold = opts.threshold ?? 3;
  const limit = opts.limit ?? 20;

  // List recent commits that touched the file (last `window`)
  const shaList = (
    await git(["log", `-n`, String(window), "--pretty=format:%H", "--", opts.file], opts.cwd)
  )
    .split("\n")
    .filter(Boolean);

  if (!shaList.length) {
    return { file: opts.file, total_commits_touching: 0, co_changed: [] };
  }

  const counts = new Map<string, number>();
  for (const sha of shaList) {
    const filesOut = await git(["show", "--name-only", "--pretty=format:", sha], opts.cwd);
    const files = filesOut.split("\n").map((s) => s.trim()).filter(Boolean);
    for (const f of files) {
      if (f === opts.file) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }

  const total = shaList.length;
  const entries: CoChangeEntry[] = Array.from(counts.entries())
    .filter(([, n]) => n >= threshold)
    .map(([file, n]) => ({ file, together: n, ratio: +(n / total).toFixed(3) }))
    .sort((a, b) => b.together - a.together)
    .slice(0, limit);

  return { file: opts.file, total_commits_touching: total, co_changed: entries };
}

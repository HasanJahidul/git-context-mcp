import { blameFile } from "./git.js";
import type { WhoTouchedResult, AuthorOwnership } from "./types.js";

export async function whoTouched(opts: {
  cwd: string;
  file: string;
  lineRange?: [number, number];
  function?: string;
}): Promise<WhoTouchedResult> {
  const lines = await blameFile(opts.file, { cwd: opts.cwd, lineRange: opts.lineRange });

  const byKey = new Map<string, AuthorOwnership & { _commits: Set<string> }>();
  for (const l of lines) {
    const key = `${l.author}|${l.authorMail}`;
    const existing = byKey.get(key);
    const dateIso = new Date(l.authorTime * 1000).toISOString();
    if (existing) {
      existing.lines += 1;
      existing._commits.add(l.sha);
      if (dateIso > existing.last_commit_date) existing.last_commit_date = dateIso;
    } else {
      byKey.set(key, {
        name: l.author,
        email: l.authorMail,
        lines: 1,
        commits: 0,
        last_commit_date: dateIso,
        _commits: new Set([l.sha]),
      });
    }
  }

  const authors: AuthorOwnership[] = Array.from(byKey.values())
    .map(({ _commits, ...rest }) => ({ ...rest, commits: _commits.size }))
    .sort((a, b) => b.lines - a.lines);

  return {
    file: opts.file,
    function: opts.function,
    line_range: opts.lineRange ? `${opts.lineRange[0]}-${opts.lineRange[1]}` : undefined,
    total_lines: lines.length,
    authors,
    primary_owner: authors[0]?.name ?? null,
  };
}

import { git, gitOriginUrl, parseRemoteUrl } from "./git.js";
import { fetchPRForCommit, parsePRNumberFromMessage, parseIssuesFromMessage } from "./github.js";
import type { CommitContextResult } from "./types.js";

export async function commitContext(opts: { cwd: string; sha: string }): Promise<CommitContextResult> {
  const fmt = "%H%n%h%n%an%n%aI%n%s%n--BODY--%n%b%n--END--";
  const showOut = await git(["show", "--no-patch", `--format=${fmt}`, opts.sha], opts.cwd);
  const lines = showOut.split("\n");
  const sha = lines[0];
  const short = lines[1];
  const author = lines[2];
  const date = lines[3];
  const subject = lines[4];
  const bodyStart = lines.indexOf("--BODY--");
  const bodyEnd = lines.indexOf("--END--");
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? lines.slice(bodyStart + 1, bodyEnd).join("\n").trim() : "";

  const numstat = await git(["show", "--numstat", "--pretty=format:", opts.sha], opts.cwd);
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    insertions += m[1] === "-" ? 0 : parseInt(m[1], 10);
    deletions += m[2] === "-" ? 0 : parseInt(m[2], 10);
    files.push(m[3]);
  }

  const fullMessage = `${subject}\n\n${body}`;
  const related_issues = parseIssuesFromMessage(fullMessage);

  let pr = null;
  const remoteUrl = await gitOriginUrl(opts.cwd);
  const parsed = remoteUrl ? parseRemoteUrl(remoteUrl) : null;
  if (parsed) {
    const numFromMsg = parsePRNumberFromMessage(fullMessage);
    if (numFromMsg) {
      pr = await fetchPRForCommit({ owner: parsed.owner, repo: parsed.repo, prNumber: numFromMsg });
    }
    if (!pr) {
      pr = await fetchPRForCommit({ owner: parsed.owner, repo: parsed.repo, commitSha: sha });
    }
  }

  return {
    sha,
    short_sha: short,
    author,
    date,
    subject,
    body,
    files_changed: files,
    insertions,
    deletions,
    pr,
    related_issues,
  };
}

import { git, blameFile, gitOriginUrl, parseRemoteUrl } from "./git.js";
import { fetchPRForCommit, parsePRNumberFromMessage } from "./github.js";
import type { IntroducingPRResult } from "./types.js";

export async function introducingPR(opts: {
  cwd: string;
  file?: string;
  line?: number;
  commit?: string;
}): Promise<IntroducingPRResult> {
  let sha = opts.commit;
  if (!sha) {
    if (!opts.file || !opts.line) {
      throw new Error("Provide either commit OR (file + line)");
    }
    const blame = await blameFile(opts.file, { cwd: opts.cwd, lineRange: [opts.line, opts.line] });
    if (!blame.length) throw new Error(`No blame for ${opts.file}:${opts.line}`);
    sha = blame[0].sha;
  }

  const showOut = await git(["show", "--no-patch", "--format=%H%n%an%n%ae%n%aI%n%B", sha], opts.cwd);
  const parts = showOut.split("\n");
  const fullSha = parts[0];
  const author = parts[1];
  const date = parts[3];
  const message = parts.slice(4).join("\n").trim();

  const result: IntroducingPRResult = {
    commit: fullSha,
    commit_message: message,
    commit_date: date,
    author,
    pr: null,
    source: "not-found",
  };

  const numFromMsg = parsePRNumberFromMessage(message);
  const remoteUrl = await gitOriginUrl(opts.cwd);
  const parsed = remoteUrl ? parseRemoteUrl(remoteUrl) : null;

  if (parsed) {
    if (numFromMsg) {
      const pr = await fetchPRForCommit({ owner: parsed.owner, repo: parsed.repo, prNumber: numFromMsg });
      if (pr) {
        result.pr = pr;
        result.source = "merge-commit-parse";
        return result;
      }
    }
    const pr = await fetchPRForCommit({ owner: parsed.owner, repo: parsed.repo, commitSha: fullSha });
    if (pr) {
      result.pr = pr;
      result.source = "github-api";
    }
  }

  return result;
}

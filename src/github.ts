import { Octokit } from "@octokit/rest";
import type { PRRef } from "./types.js";

let cached: Octokit | null = null;

export function getOctokit(): Octokit | null {
  if (cached) return cached;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) return null;
  cached = new Octokit({ auth: token });
  return cached;
}

export interface PRLookupArgs {
  owner: string;
  repo: string;
  commitSha?: string;
  prNumber?: number;
}

export async function fetchPRForCommit(args: PRLookupArgs): Promise<PRRef | null> {
  const oct = getOctokit();
  if (!oct) return null;
  if (args.prNumber) {
    return await fetchPRByNumber(oct, args.owner, args.repo, args.prNumber);
  }
  if (!args.commitSha) return null;
  try {
    const r = await oct.repos.listPullRequestsAssociatedWithCommit({
      owner: args.owner,
      repo: args.repo,
      commit_sha: args.commitSha,
      per_page: 5,
    });
    const pr = r.data?.[0];
    if (!pr) return null;
    return await fetchPRByNumber(oct, args.owner, args.repo, pr.number);
  } catch {
    return null;
  }
}

async function fetchPRByNumber(oct: Octokit, owner: string, repo: string, num: number): Promise<PRRef | null> {
  try {
    const pr = (await oct.pulls.get({ owner, repo, pull_number: num })).data;
    let reviewers: string[] = [];
    try {
      const r = await oct.pulls.listReviews({ owner, repo, pull_number: num, per_page: 100 });
      reviewers = Array.from(new Set(r.data.map((x) => x.user?.login).filter((x): x is string => Boolean(x))));
    } catch {
      reviewers = (pr.requested_reviewers ?? [])
        .map((u: any) => u?.login)
        .filter((x: any): x is string => Boolean(x));
    }
    return {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      merged_at: pr.merged_at,
      author: pr.user?.login ?? "",
      reviewers,
    };
  } catch {
    return null;
  }
}

export function parsePRNumberFromMessage(msg: string): number | null {
  // matches "Merge pull request #123" or "(#123)" or "PR-123"
  const m = msg.match(/(?:pull request #|\(#|PR-?)(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function parseIssuesFromMessage(msg: string): number[] {
  // matches "Fixes #123", "Closes #45", "Resolves #67", or bare "#NNN"
  const out = new Set<number>();
  const re = /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg)) !== null) out.add(parseInt(m[1], 10));
  return Array.from(out);
}

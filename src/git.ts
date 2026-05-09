import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class GitError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "GitError";
  }
}

export async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (e: any) {
    throw new GitError(e?.message ?? "git failed", e?.stderr);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--git-dir"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoRoot(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

export async function defaultBranch(cwd: string): Promise<string> {
  // try origin/HEAD symbolic-ref, fall back to common names
  try {
    const out = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
    return out.trim().replace(/^refs\/remotes\/origin\//, "");
  } catch {
    const branches = (await git(["branch", "-r"], cwd)).split("\n").map((s) => s.trim());
    for (const cand of ["main", "master", "develop"]) {
      if (branches.some((b) => b === `origin/${cand}`)) return cand;
    }
    return "main";
  }
}

export async function gitOriginUrl(cwd: string): Promise<string | null> {
  try {
    return (await git(["config", "--get", "remote.origin.url"], cwd)).trim() || null;
  } catch {
    return null;
  }
}

export interface ParsedRemote {
  host: string;
  owner: string;
  repo: string;
}

export function parseRemoteUrl(url: string): ParsedRemote | null {
  const ssh = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
  const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?(?:\/)?$/);
  if (https) return { host: https[1], owner: https[2], repo: https[3] };
  return null;
}

export interface BlameLine {
  sha: string;
  author: string;
  authorMail: string;
  authorTime: number;
  lineNo: number;
  content: string;
}

export async function blameFile(file: string, opts: { cwd: string; lineRange?: [number, number] }): Promise<BlameLine[]> {
  const args = ["blame", "--porcelain"];
  if (opts.lineRange) args.push("-L", `${opts.lineRange[0]},${opts.lineRange[1]}`);
  args.push("--", file);
  const out = await git(args, opts.cwd);
  return parsePorcelainBlame(out);
}

export function parsePorcelainBlame(porcelain: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = porcelain.split("\n");
  const meta = new Map<string, Record<string, string>>();
  let i = 0;
  while (i < lines.length) {
    const header = lines[i++];
    if (!header) break;
    const m = header.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
    if (!m) continue;
    const sha = m[1];
    const lineNo = parseInt(m[3], 10);
    const seen = meta.get(sha) ?? {};
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const kv = lines[i++];
      const sp = kv.indexOf(" ");
      if (sp === -1) continue;
      const k = kv.slice(0, sp);
      const v = kv.slice(sp + 1);
      seen[k] = v;
    }
    meta.set(sha, seen);
    const content = (lines[i++] ?? "").replace(/^\t/, "");
    out.push({
      sha,
      author: seen.author ?? "",
      authorMail: (seen["author-mail"] ?? "").replace(/^<|>$/g, ""),
      authorTime: parseInt(seen["author-time"] ?? "0", 10),
      lineNo,
      content,
    });
  }
  return out;
}

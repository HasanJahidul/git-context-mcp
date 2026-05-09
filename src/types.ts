export interface AuthorOwnership {
  name: string;
  email: string;
  lines: number;
  commits: number;
  last_commit_date: string;
}

export interface WhoTouchedResult {
  file: string;
  function?: string;
  line_range?: string;
  total_lines: number;
  authors: AuthorOwnership[];
  primary_owner: string | null;
}

export interface PRRef {
  number: number;
  title: string;
  url: string;
  merged_at: string | null;
  author: string;
  reviewers: string[];
}

export interface IntroducingPRResult {
  commit: string;
  commit_message: string;
  commit_date: string;
  author: string;
  pr: PRRef | null;
  source: "merge-commit-parse" | "github-api" | "not-found";
}

export interface CoChangeEntry {
  file: string;
  together: number;
  ratio: number;
}

export interface CoChangeResult {
  file: string;
  total_commits_touching: number;
  co_changed: CoChangeEntry[];
}

export interface BranchInfo {
  name: string;
  ahead: number;
  behind: number;
  last_commit_date: string;
  last_commit_author: string;
  merged: boolean;
  stale: boolean;
}

export interface RecentWorkResult {
  author: string;
  since: string;
  commit_count: number;
  files_touched: number;
  insertions: number;
  deletions: number;
  commits: Array<{
    sha: string;
    date: string;
    subject: string;
    pr?: number;
  }>;
}

export interface CommitContextResult {
  sha: string;
  short_sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files_changed: string[];
  insertions: number;
  deletions: number;
  pr: PRRef | null;
  related_issues: number[];
}

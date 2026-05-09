#!/usr/bin/env node
import { whoTouched } from "./who-touched.js";
import { coChange } from "./co-change.js";
import { branchHygiene } from "./branch-hygiene.js";
import { recentWork } from "./recent-work.js";
import { commitContext } from "./commit-context.js";
import { introducingPR } from "./introducing-pr.js";

const args = process.argv.slice(2);
const cmd = args[0];
const cwd = process.cwd();

async function main() {
  switch (cmd) {
    case undefined:
    case "server":
      await import("./index.js");
      return;
    case "who-touched": {
      const file = args[1];
      if (!file) return die("usage: git-context-mcp who-touched <file>");
      console.log(JSON.stringify(await whoTouched({ cwd, file }), null, 2));
      return;
    }
    case "co-change": {
      const file = args[1];
      if (!file) return die("usage: git-context-mcp co-change <file>");
      console.log(JSON.stringify(await coChange({ cwd, file }), null, 2));
      return;
    }
    case "branches": {
      console.log(JSON.stringify(await branchHygiene({ cwd }), null, 2));
      return;
    }
    case "recent": {
      const author = args[1];
      console.log(JSON.stringify(await recentWork({ cwd, author }), null, 2));
      return;
    }
    case "commit": {
      const sha = args[1];
      if (!sha) return die("usage: git-context-mcp commit <sha>");
      console.log(JSON.stringify(await commitContext({ cwd, sha }), null, 2));
      return;
    }
    case "intro-pr": {
      const arg = args[1];
      if (!arg) return die("usage: git-context-mcp intro-pr <sha>  OR  intro-pr <file>:<line>");
      if (arg.includes(":")) {
        const [file, lineStr] = arg.split(":");
        console.log(JSON.stringify(await introducingPR({ cwd, file, line: parseInt(lineStr, 10) }), null, 2));
      } else {
        console.log(JSON.stringify(await introducingPR({ cwd, commit: arg }), null, 2));
      }
      return;
    }
    case "--version":
    case "-v": {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(await readFile(join(here, "..", "package.json"), "utf8"));
      console.log(pkg.version);
      return;
    }
    case "--help":
    case "-h":
      help();
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      help();
      process.exit(1);
  }
}

function die(msg: string) {
  console.error(msg);
  process.exit(1);
}

function help() {
  console.log(`git-context-mcp — semantic git queries

USAGE
  git-context-mcp [command] [args]

COMMANDS
  (none)                  Start MCP stdio server (for Claude/Cursor/etc)
  server                  Same as above
  who-touched <file>      Authorship breakdown by author
  co-change <file>        Files most often changed together
  branches                Branch hygiene report
  recent [author]         Recent work (defaults to current user)
  commit <sha>            Full commit context (subject, body, files, PR, issues)
  intro-pr <sha>          PR that introduced a commit
  intro-pr <file>:<line>  PR that introduced a line
  --version               Print version
  --help                  This help

ENV
  GH_TOKEN | GITHUB_TOKEN  GitHub token for PR/issue lookups (optional but recommended)

INSTALL AS MCP
  claude mcp add --scope user git-context -- git-context-mcp
`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

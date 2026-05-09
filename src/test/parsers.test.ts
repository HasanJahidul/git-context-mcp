import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePorcelainBlame, parseRemoteUrl } from "../git.js";
import { parsePRNumberFromMessage, parseIssuesFromMessage } from "../github.js";

test("parseRemoteUrl: ssh", () => {
  const r = parseRemoteUrl("git@github.com:HasanJahidul/localhost-mcp.git");
  assert.deepEqual(r, { host: "github.com", owner: "HasanJahidul", repo: "localhost-mcp" });
});

test("parseRemoteUrl: https with .git", () => {
  const r = parseRemoteUrl("https://github.com/HasanJahidul/localhost-mcp.git");
  assert.deepEqual(r, { host: "github.com", owner: "HasanJahidul", repo: "localhost-mcp" });
});

test("parseRemoteUrl: https without .git", () => {
  const r = parseRemoteUrl("https://github.com/HasanJahidul/localhost-mcp");
  assert.deepEqual(r, { host: "github.com", owner: "HasanJahidul", repo: "localhost-mcp" });
});

test("parseRemoteUrl: garbage returns null", () => {
  assert.equal(parseRemoteUrl("not a url"), null);
});

test("parsePRNumberFromMessage: 'Merge pull request #123'", () => {
  assert.equal(parsePRNumberFromMessage("Merge pull request #123 from x/y"), 123);
});

test("parsePRNumberFromMessage: '(#42)' suffix", () => {
  assert.equal(parsePRNumberFromMessage("feat: add feature (#42)"), 42);
});

test("parsePRNumberFromMessage: PR-12 form", () => {
  assert.equal(parsePRNumberFromMessage("Refs PR-12: rework auth"), 12);
});

test("parsePRNumberFromMessage: nothing", () => {
  assert.equal(parsePRNumberFromMessage("just a normal commit"), null);
});

test("parseIssuesFromMessage: Fixes #123", () => {
  assert.deepEqual(parseIssuesFromMessage("Fixes #123, also closes #456"), [123, 456]);
});

test("parseIssuesFromMessage: Resolves #1 and resolves #2", () => {
  assert.deepEqual(parseIssuesFromMessage("Resolves #1 and resolves #2"), [1, 2]);
});

test("parseIssuesFromMessage: dedupe", () => {
  assert.deepEqual(parseIssuesFromMessage("Fixes #5\nCloses #5"), [5]);
});

test("parseIssuesFromMessage: ignores bare #N without verb", () => {
  assert.deepEqual(parseIssuesFromMessage("references #99 but not closing"), []);
});

test("parsePorcelainBlame: single line", () => {
  const sample =
    "abcdef0123456789abcdef0123456789abcdef01 1 1 1\n" +
    "author Jane Dev\n" +
    "author-mail <jane@x.com>\n" +
    "author-time 1700000000\n" +
    "summary first\n" +
    "filename a.txt\n" +
    "\thello world";
  const r = parsePorcelainBlame(sample);
  assert.equal(r.length, 1);
  assert.equal(r[0].sha, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(r[0].author, "Jane Dev");
  assert.equal(r[0].authorMail, "jane@x.com");
  assert.equal(r[0].authorTime, 1700000000);
  assert.equal(r[0].lineNo, 1);
  assert.equal(r[0].content, "hello world");
});

test("parsePorcelainBlame: same sha repeats with abbreviated header", () => {
  const sample =
    "abcdef0123456789abcdef0123456789abcdef01 1 1 1\n" +
    "author Jane Dev\n" +
    "author-mail <jane@x.com>\n" +
    "author-time 1700000000\n" +
    "summary first\n" +
    "filename a.txt\n" +
    "\tline one\n" +
    "abcdef0123456789abcdef0123456789abcdef01 2 2\n" +
    "\tline two";
  const r = parsePorcelainBlame(sample);
  assert.equal(r.length, 2);
  assert.equal(r[0].content, "line one");
  assert.equal(r[1].content, "line two");
  assert.equal(r[1].author, "Jane Dev"); // inherits cached metadata
  assert.equal(r[1].lineNo, 2);
});

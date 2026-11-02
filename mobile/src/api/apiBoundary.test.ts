// CLAUDE.md §9.2: no screen or component calls the HTTP client directly —
// every request goes through a named fetcher in src/api.
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });

const CLIENT = String.raw`["'][./]*api/client["']`;
// The store may configure the client (token, base URL, handlers); it may not send.
// Type-only imports carry no code, so they cannot send either.
const SENDERS = /\b(apiClient|post|postData|default)\b/;

/** Does this source take a way to send requests from api/client? */
function sendsRequests(source: string): boolean {
  if (new RegExp(String.raw`require\(\s*${CLIENT}\s*\)`).test(source)) return true;
  const imports = source.matchAll(new RegExp(String.raw`import\s+(type\s+)?([^;]*?)\s+from\s+${CLIENT}`, "g"));
  for (const [, typeOnly, clause] of imports) {
    if (typeOnly) continue;
    // `import client from`, `import * as client from`, or a named sender.
    if (/^\w+/.test(clause!) || clause!.startsWith("*")) return true;
    const named = clause!.replace(/\btype\s+\w+(\s+as\s+\w+)?/g, "");
    if (SENDERS.test(named)) return true;
  }
  return false;
}

it.each([
  ['import { apiClient } from "../../api/client";', true],
  ['import { post, setAuthToken } from "../api/client";', true],
  ['import client from "../../api/client";', true],
  ['import * as client from "../../api/client";', true],
  ['const { apiClient } = require("../../api/client");', true],
  ['import { setAuthToken, setReauthHandler } from "../api/client";', false],
  ['import type { AxiosRequestConfig } from "../../api/client";', false],
  ['import { type PostOptions } from "../../api/client";', false],
  ['import { apiClient } from "../../api/clientele";', false],
])("sendsRequests(%s) is %s", (source, expected) => {
  expect(sendsRequests(source)).toBe(expected);
});

it("only src/api (and the test transport) send requests through the api client", () => {
  const offenders = files(SRC)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => relative(SRC, f))
    .filter((f) => !f.startsWith("api/") && !f.startsWith("test/"))
    .filter((f) => sendsRequests(readFileSync(join(SRC, f), "utf8")));
  expect(offenders).toEqual([]);
});

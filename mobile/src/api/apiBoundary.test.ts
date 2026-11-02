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

// The store may configure the client (token, base URL, handlers); it may not send.
const SENDS = /import\s+(\w+\s*,?\s*)?(\{[^}]*\b(apiClient|post|postData)\b[^}]*\})?\s*from\s+["'][./]*api\/client["']/;

it("only src/api (and the test transport) send requests through the api client", () => {
  const offenders = files(SRC)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => relative(SRC, f))
    .filter((f) => !f.startsWith("api/") && !f.startsWith("test/"))
    .filter((f) => {
      const m = SENDS.exec(readFileSync(join(SRC, f), "utf8"));
      return Boolean(m && (m[1] || m[2]));
    });
  expect(offenders).toEqual([]);
});

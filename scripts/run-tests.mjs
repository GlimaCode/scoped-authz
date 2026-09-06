// Hand the compiled test files to `node --test` by name.
//
// Neither shorter form works everywhere this package claims to run:
//
//   node --test dist/test          a directory argument stopped being searched
//                                  and started being resolved as a module —
//                                  MODULE_NOT_FOUND on Node 24.
//   node --test "dist/test/**"     glob patterns in positional arguments are
//                                  Node 22+, and package.json says Node 20.
//   node --test dist/test/*.js     relies on the SHELL to expand it, which sh
//                                  does and cmd.exe does not, so it fails on
//                                  Windows only — the worst kind of green CI.
//
// An explicit list is supported by every version in the matrix, and reading the
// directory keeps it from going stale when someone adds a test file.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dir = "dist/test";
let files = [];
try {
  files = readdirSync(dir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join(dir, name));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

if (files.length === 0) {
  // Exiting 1 either way; the point of catching it is that "did tsc run?" is a
  // usable message and a readdir stack trace is not.
  console.error(`no compiled tests in ${dir} — did tsc run?`);
  process.exit(1);
}

const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);

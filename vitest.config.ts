import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const screenwriterTypesDir = p("../screenwriter_types");

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // Only subpaths that do not pull in writing_core are used (keys, commands).
  //
  // Only applied when the sibling repo is actually checked out (local dev, "local-packages phase");
  // otherwise falls through to the real, published `@sudobility/screenwriter_types` npm dependency
  // (package.json). NOTE: as of this dependency's own package.json, its `exports` map only declares
  // `.` and `./test` — `@sudobility/screenwriter_types/keys` (imported by src/client.ts) is not an
  // exported subpath, so a real npm install of it will still fail this specific import with
  // ERR_PACKAGE_PATH_NOT_EXPORTED until screenwriter_types adds a `./keys` (and any other imported
  // subpath) entry to its own `exports`.
  resolve: {
    alias: existsSync(screenwriterTypesDir)
      ? [{ find: /^@sudobility\/screenwriter_types\/(.*)$/, replacement: p("../screenwriter_types/src/") + "$1" }]
      : [],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

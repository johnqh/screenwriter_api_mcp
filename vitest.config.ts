import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // Only subpaths that do not pull in writing_core are used (keys, commands).
  resolve: {
    alias: [
      { find: /^@sudobility\/screenwriter_types\/(.*)$/, replacement: p("../screenwriter_types/src/") + "$1" },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

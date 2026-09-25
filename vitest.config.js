import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              main: "./src/index.js",
              remoteBindings: false,
              miniflare: {
                compatibilityDate: "2026-08-22",
                d1Databases: ["DB"],
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  TEST_STATIC_HEADERS: fs.readFileSync(path.join(import.meta.dirname, "public", "_headers"), "utf8"),
                },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/worker/**/*.test.js"],
            setupFiles: ["./test/worker/apply-migrations.js"],
          },
        },
        {
          test: {
            name: "editor",
            environment: "happy-dom",
            include: ["test/editor/**/*.test.js"],
          },
        },
      ],
    },
  };
});

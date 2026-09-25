import { rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.join(import.meta.dirname, "..");
const outdir = path.join(root, "public", "build");

await rm(outdir, { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { site: "client/site.js", admin: "client/admin/main.js" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["es2022", "chrome111", "firefox114", "safari16.4"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  chunkNames: "chunks/[name]-[hash]",
  metafile: true,
  logLevel: "warning",
});

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => !file.includes("/chunks/"));
outputs.forEach(([file, info]) => console.log(`${path.relative(root, file)} ${(info.bytes / 1024).toFixed(1)} KiB`));

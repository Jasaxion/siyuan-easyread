import { build } from "esbuild";
import { mkdir, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await Promise.all([
  build({ entryPoints: ["src/index.ts"], bundle: true, outfile: "dist/index.js", platform: "browser", format: "cjs", target: "es2020", external: ["siyuan"] }),
  build({ entryPoints: ["src/kernel.ts"], bundle: true, outfile: "dist/kernel.js", platform: "neutral", format: "iife", target: "es2020" }),
]);
for (const file of ["plugin.json", "README.md", "LICENSE"]) await cp(file, `dist/${file}`);
await cp("src/index.css", "dist/index.css");
await rm("package.zip", { force: true });
execFileSync("zip", ["-q", "-r", "../package.zip", "."], { cwd: "dist" });
console.log("Built dist/ and package.zip (frontend + kernel)");

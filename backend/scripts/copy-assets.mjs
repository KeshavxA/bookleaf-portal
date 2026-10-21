// tsc only emits .js; the per-category knowledge-base markdown files are runtime assets.
import { cpSync } from "node:fs";
cpSync("src/ai/kb", "dist/ai/kb", { recursive: true, filter: (p) => !p.endsWith(".ts") });
console.log("copied src/ai/kb -> dist/ai/kb");

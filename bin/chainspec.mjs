#!/usr/bin/env node
import { readFile, mkdir, writeFile, lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { generateSDK, MAX_BYTES, VERSION } from "../lib/core/index.js";
const args = process.argv.slice(2),
  opts = {};
let inputPath, output;
try {
  if (args.includes("--help") || !args.length) {
    console.log(
      "chainspec --in openapi.json --out ./new-sdk [--namespace main] [--strip-prefix /v1/api] [--group-by path|tag] [--base-url URL] [--no-hooks]\nReads local JSON only; creates a new output directory, never overwrites it.",
    );
    process.exit(0);
  }
  if (args.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--no-hooks") {
      opts.hooks = false;
      continue;
    }
    if (
      ![
        "--in",
        "--out",
        "--namespace",
        "--strip-prefix",
        "--group-by",
        "--base-url",
      ].includes(flag)
    )
      throw Error("Unknown option; use --help");
    const val = args[++i];
    if (!val || val.startsWith("--")) throw Error("Missing option value");
    if (flag === "--in") inputPath = val;
    else if (flag === "--out") output = val;
    else
      opts[
        {
          "--namespace": "namespace",
          "--strip-prefix": "stripPrefix",
          "--group-by": "groupBy",
          "--base-url": "baseUrl",
        }[flag]
      ] = val;
  }
  if (!inputPath || !output) throw Error("--in and --out are required");
  if (opts.groupBy && !["path", "tag"].includes(opts.groupBy))
    throw Error("--group-by must be path or tag");
  const stat = await lstat(inputPath);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw Error("Input must be a regular JSON file of at most 8 MiB");
  const result = generateSDK(
    new TextDecoder("utf-8", { fatal: true }).decode(await readFile(inputPath)),
    opts,
  );
  const dir = resolve(output);
  await mkdir(dir, { mode: 0o700 });
  try {
    for (const [file, text] of Object.entries(result.files))
      await writeFile(resolve(dir, file), text, { flag: "wx", mode: 0o600 });
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  console.log(
    `Generated ${result.operations.length} operations, ${result.schemaCount} schemas, ${result.diagnostics.length} diagnostics.\nOutput: ${dir}`,
  );
} catch (error) {
  console.error(
    error?.code === "EEXIST"
      ? "Output already exists; choose a new directory."
      : error instanceof Error
        ? error.message
        : "Generation failed",
  );
  process.exitCode = 1;
}

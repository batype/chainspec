#!/usr/bin/env node
import { readFile, mkdir, writeFile, lstat, rm, readdir, rename } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { generateSDK, parseConfig, fetchDocument, MAX_BYTES, VERSION } from "../lib/core/index.js";
const args = process.argv.slice(2), opts = {};
const marker = ".chainspec-generated.json";
const digest = text => createHash("sha256").update(text).digest("hex");
let inputPath, output, configPath, update = false;
async function localJSON(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    throw Error("Input must be a regular JSON file of at most 8 MiB");
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}
async function exists(path) {
  try { return await lstat(path); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
try {
  if (args.includes("--help") || !args.length) {
    console.log("chainspec --config chainspec.config.json [--update]\nchainspec --in openapi.json|https://example.com/api-json --out ./new-sdk [--namespace main] [--strip-prefix /v1/api] [--group-by path|tag] [--base-url URL] [--no-hooks]\nPaths in JSON resolve relative to the config file; explicit CLI flags override JSON.\nCreates a new directory. --update replaces only an unchanged CLI-generated directory.");
    process.exit(0);
  }
  if (args.includes("--version")) { console.log(VERSION); process.exit(0); }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--no-hooks") { opts.hooks = false; continue; }
    if (flag === "--update") { update = true; continue; }
    if (!["--config", "--in", "--out", "--namespace", "--strip-prefix", "--group-by", "--base-url"].includes(flag))
      throw Error("Unknown option; use --help");
    const val = args[++i];
    if (!val || val.startsWith("--")) throw Error("Missing option value");
    if (flag === "--config") configPath = resolve(val);
    else if (flag === "--in") inputPath = val;
    else if (flag === "--out") output = val;
    else opts[{"--namespace":"namespace", "--strip-prefix":"stripPrefix", "--group-by":"groupBy", "--base-url":"baseUrl"}[flag]] = val;
  }
  const config = configPath ? parseConfig(await localJSON(configPath)) : undefined;
  const base = configPath ? dirname(configPath) : process.cwd();
  const source = inputPath ?? config?.input;
  const destination = output ? resolve(output) : config ? resolve(base, config.output) : undefined;
  if (!source || !destination) throw Error("--in and --out, or --config, are required");
  const settings = { ...config, ...opts };
  if (settings.groupBy && !["path", "tag"].includes(settings.groupBy)) throw Error("--group-by must be path or tag");
  const text = /^[a-z][a-z\d+.-]*:/i.test(source)
    ? await fetchDocument(source)
    : await localJSON(resolve(inputPath ? process.cwd() : base, source));
  const result = generateSDK(text, settings);
  const dir = destination;
  const old = await exists(dir);
  if (old) {
    if (!update) throw Object.assign(Error("Output already exists; choose a new directory or use --update."), { code: "EEXIST" });
    if (!old.isDirectory() || old.isSymbolicLink()) throw Error("Refusing to update a symlink or non-directory");
    const ownerStat = await exists(join(dir, marker));
    if (!ownerStat?.isFile() || ownerStat.isSymbolicLink()) throw Error("Output is not managed by this CLI; choose a new directory");
    const owner = JSON.parse(await localJSON(join(dir, marker)));
    if (owner.generator !== "ChainSpec" || !owner.files || typeof owner.files !== "object" || Array.isArray(owner.files))
      throw Error("Invalid generated-directory marker");
    const names = await readdir(dir);
    if (names.some(name => name !== marker && !Object.hasOwn(owner.files, name)))
      throw Error("Output contains extra files; move custom code outside the generated directory");
    for (const [name, hash] of Object.entries(owner.files)) {
      if (name !== basename(name) || name === marker || !names.includes(name)) throw Error("Generated files changed; choose a new directory");
      const stat = await lstat(join(dir, name));
      if (!stat.isFile() || stat.isSymbolicLink() || digest(await readFile(join(dir, name))) !== hash)
        throw Error("Generated files changed; choose a new directory to preserve edits");
    }
  }
  await mkdir(dirname(dir), { recursive: true });
  const stage = join(dirname(dir), `.${basename(dir)}.chainspec-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const files = Object.fromEntries(Object.entries(result.files).map(([name, text]) => [name, digest(text)]));
    for (const [file, text] of Object.entries(result.files))
      await writeFile(join(stage, file), text, { flag: "wx", mode: 0o600 });
    await writeFile(join(stage, marker), JSON.stringify({ generator: "ChainSpec", version: VERSION, files }, null, 2), { flag: "wx", mode: 0o600 });
    if (old) {
      const backup = `${stage}.previous`;
      await rename(dir, backup);
      try { await rename(stage, dir); }
      catch (e) { await rename(backup, dir); throw e; }
      await rm(backup, { recursive: true });
    } else {
      // Reserve destination first so a concurrently created directory is never replaced.
      await mkdir(dir, { mode: 0o700 });
      try { for (const name of await readdir(stage)) await rename(join(stage, name), join(dir, name)); }
      catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
    }
  } finally { await rm(stage, { recursive: true, force: true }); }
  console.log(`Generated ${result.operations.length} operations, ${result.schemaCount} schemas, ${result.diagnostics.length} diagnostics.\nOutput: ${dir}`);
} catch (error) {
  console.error(error?.code === "EEXIST" ? "Output already exists; choose a new directory or use --update." : error instanceof Error ? error.message : "Generation failed");
  process.exitCode = 1;
}

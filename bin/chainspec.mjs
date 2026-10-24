#!/usr/bin/env node
import { readFile, mkdir, writeFile, lstat, rm, readdir, rename } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { loadEnvFile } from "node:process";
import { createNodeTranslator } from "./translation-provider.mjs";
import { createHash, randomUUID } from "node:crypto";
import { generateSDKAsync, parseConfig, parseControllerNames, fetchDocument, sourceRequestOptions, MAX_BYTES, VERSION, resolveSDKOptions } from "../lib/core/index.js";
const args = process.argv.slice(2), opts = {};
const marker = ".chainspec-generated.json";
const digest = text => createHash("sha256").update(text).digest("hex");
let inputPath, output, configPath, envPath, update = false, preserveBuild = false;
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
// Build output is preserved, never treated as disposable generated source.
async function checkBuildDirectory(path, budget = { remaining: 10000 }) {
  if (--budget.remaining < 0) throw Error("Build directory is too large to update safely");
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error("Refusing to preserve a build directory containing symlinks or special files");
  if (stat.isDirectory()) for (const name of await readdir(path)) await checkBuildDirectory(join(path, name), budget);
}
try {
  if (args[0] === "translate-server") {
    const { runTranslationServer } = await import("./translation-server.mjs");
    await runTranslationServer(args.slice(1));
  } else {
  if (args.includes("--help") || !args.length) {
    console.log("chainspec --config chainspec.config.json [--update] [--no-translate] [--env-file .env]\nchainspec translate-server --config chainspec.config.json [--env-file .env] [--origin https://batype.github.io]\nchainspec --in openapi.json|https://example.com/api-json --out ./new-sdk [--namespace main] [--strip-prefix /v1/api] [--group-by path|tag] [--base-url URL] [--no-hooks] [--target node|browser|react|next|vite-ssr|all]\nPaths in JSON resolve relative to the config file; explicit CLI flags override JSON.\nCreates a new directory. --update replaces only unchanged CLI-generated source, preserves declared dist, and requires rebuilding.");
    process.exit(0);
  }
  if (args.includes("--version")) { console.log(VERSION); process.exit(0); }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--no-hooks") { opts.hooks = false; continue; }
    if (flag === "--update") { update = true; continue; }
    if (flag === "--translate") { opts.translateNames = true; continue; }
    if (flag === "--no-translate") { opts.translateNames = false; continue; }
    if (!["--env-file", "--config", "--in", "--out", "--namespace", "--strip-prefix", "--group-by", "--base-url", "--target"].includes(flag))
      throw Error("Unknown option; use --help");
    const val = args[++i];
    if (!val || val.startsWith("--")) throw Error("Missing option value");
    if (flag === "--env-file") envPath = resolve(val);
    else if (flag === "--config") configPath = resolve(val);
    else if (flag === "--in") inputPath = val;
    else if (flag === "--out") output = val;
    else opts[{"--target":"target", "--namespace":"namespace", "--strip-prefix":"stripPrefix", "--group-by":"groupBy", "--base-url":"baseUrl"}[flag]] = val;
  }
  const configText = configPath ? await localJSON(configPath) : undefined;
  const config = configText ? parseConfig(configText) : undefined;
  const base = configPath ? dirname(configPath) : process.cwd();
  const source = inputPath ?? config?.input;
  const destination = output ? resolve(output) : config ? resolve(base, config.output) : undefined;
  if (!source || !destination) throw Error("--in and --out, or --config, are required");
  const settings = { ...config, ...opts };
  resolveSDKOptions(settings);
  if (settings.groupBy && !["path", "tag"].includes(settings.groupBy)) throw Error("--group-by must be path or tag");
  if (envPath) loadEnvFile(envPath);
  else if (configPath) {
    try { loadEnvFile(resolve(base, ".env")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const text = /^[a-z][a-z\d+.-]*:/i.test(source)
    ? await fetchDocument(source, undefined, sourceRequestOptions(config?.sourceRequest, process.env))
    : await localJSON(resolve(inputPath ? process.cwd() : base, source));
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
    for (const [name, hash] of Object.entries(owner.files)) {
      if (name !== basename(name) || name === marker || !names.includes(name)) throw Error("Generated files changed; choose a new directory");
      const stat = await lstat(join(dir, name));
      if (!stat.isFile() || stat.isSymbolicLink() || digest(await readFile(join(dir, name))) !== hash)
        throw Error("Generated files changed; choose a new directory to preserve edits");
    }
    if (names.includes("dist")) {
      const configs = ["tsconfig.json", "tsconfig.node.json"].filter(name => Object.hasOwn(owner.files, name));
      let declared = false;
      for (const name of configs) if (["./dist", "dist"].includes(JSON.parse(await localJSON(join(dir, name))).compilerOptions?.outDir)) declared = true;
      if (declared) {
        const build = await lstat(join(dir, "dist"));
        if (!build.isDirectory() || build.isSymbolicLink()) throw Error("Refusing to preserve a non-directory or symlink dist");
        await checkBuildDirectory(join(dir, "dist"));
        preserveBuild = true;
      }
    }
    if (names.some(name => name !== marker && !(preserveBuild && name === "dist") && !Object.hasOwn(owner.files, name)))
      throw Error("Output contains extra files; move custom code outside the generated directory");
  }
  let cachedNames = {};
  if (old && await exists(join(dir, "controller-names.json")))
    cachedNames = parseControllerNames(await localJSON(join(dir, "controller-names.json")));
  const translate = createNodeTranslator(settings.translation ?? { provider: "mymemory" });
  const result = await generateSDKAsync(text, {
    ...settings, controllerNames: { ...cachedNames, ...settings.controllerNames },
  }, { translate });
  for (const diagnostic of result.diagnostics.filter(d => d.code.startsWith("translation-")))
    console.warn(diagnostic.message);
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
      let movedBuild = false;
      try {
        if (preserveBuild) { await rename(join(backup, "dist"), join(stage, "dist")); movedBuild = true; }
        await rename(stage, dir);
      } catch (e) {
        if (movedBuild) await rename(join(stage, "dist"), join(backup, "dist"));
        await rename(backup, dir); throw e;
      }
      await rm(backup, { recursive: true });
    } else {
      // Reserve destination first so a concurrently created directory is never replaced.
      await mkdir(dir, { mode: 0o700 });
      try { for (const name of await readdir(stage)) await rename(join(stage, name), join(dir, name)); }
      catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
    }
  } finally { await rm(stage, { recursive: true, force: true }); }
  if (configPath && config && JSON.stringify(config.controllerNames ?? {}) !== JSON.stringify(result.controllerNames)) {
    const temp = `${configPath}.chainspec-${randomUUID()}.tmp`;
    try {
      if (await localJSON(configPath) !== configText) throw Error("Configuration changed during generation");
      const mode = (await lstat(configPath)).mode & 0o777;
      await writeFile(temp, JSON.stringify({ ...config, controllerNames: result.controllerNames }, null, 2) + "\n", { flag: "wx", mode });
      await rename(temp, configPath);
      console.log("Saved English group names to config; future runs reuse them without translation.");
    } catch {
      console.warn("SDK generated, but config cache was not saved (changed or not writable). Names remain in controller-names.json.");
    } finally { await rm(temp, { force: true }); }
  }
  if (preserveBuild) console.log("Preserved dist without modifying its files. Run npm run build to refresh the compiled SDK.");
  console.log(`Generated ${result.operations.length} operations, ${result.schemaCount} schemas, ${result.diagnostics.length} diagnostics.\nOutput: ${dir}`);
}
} catch (error) {
  console.error(error?.code === "EEXIST" ? "Output already exists; choose a new directory or use --update." : error instanceof Error ? error.message : "Generation failed");
  process.exitCode = 1;
}

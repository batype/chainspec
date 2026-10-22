import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateSDK, parseConfig, fetchDocument, DEFAULT_CONFIG, MAX_BYTES } from "../lib/core/index.js";
const dir = await mkdtemp(join(tmpdir(), "chainspec-config-"));
after(() => rm(dir, { recursive: true, force: true }));
const spec = { openapi: "3.0.3", info: { title: "Config fixture", version: "1" }, paths: {
  "/v1/api/sms/sendSmsLogin": { post: { tags: ["短信管理", "备用"], operationId: "SendSmsLogin", responses: { 204: { description: "OK" } } } },
  "/v1/api/other/send": { post: { tags: ["短信管理"], operationId: "Other", responses: { 204: { description: "OK" } } } },
} };
const cli = resolve("bin/chainspec.mjs");
async function run(args, cwd = dir) {
  const process = spawn(globalThis.process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  process.stdout.on("data", chunk => stdout += chunk);
  process.stderr.on("data", chunk => stderr += chunk);
  const [status] = await once(process, "close");
  return { status, stdout, stderr };
}
test("first Chinese tag keeps one group, produces ASCII identifiers, supports explicit aliases and stable collisions", () => {
  const generated = generateSDK(spec, { groupBy: "tag" });
  assert.equal(new Set(generated.operations.map(op => op.controller)).size, 1);
  for (const op of generated.operations) assert.match(op.controller, /^[A-Za-z_$][A-Za-z0-9_$]*$/);
  assert.equal(generated.diagnostics.filter(d => d.code === "group-name-fallback").length, 1);
  assert(generated.operations.every(op => op.tags[0] === "短信管理"));
  const mapped = generateSDK(spec, { groupBy: "tag", controllerNames: { 短信管理: "sms" } });
  assert(mapped.operations.every(op => op.controller === "sms"));
  assert(mapped.operations.some(op => op.id === "main.sms.sendSmsLogin"));
  const collision = structuredClone(spec);
  collision.paths["/v1/api/sms/sendSmsLogin"].post.tags = ["消息管理"];
  collision.paths["/v1/api/sms/z"] = { get: { tags: ["短信管理"], responses: { 204: { description: "OK" } } } };
  const one = generateSDK(collision, { groupBy: "tag", controllerNames: { 消息管理: "sms", 短信管理: "sms" } });
  const two = generateSDK(collision, { groupBy: "tag", controllerNames: { 消息管理: "sms", 短信管理: "sms" } });
  assert.deepEqual(one.operations.map(op => op.id), two.operations.map(op => op.id));
  assert.equal(new Set(one.operations.filter(op => op.tags[0] === "短信管理").map(op => op.controller)).size, 1);
  assert.equal(new Set(one.operations.map(op => op.controller)).size, 2);
  assert.throws(() => generateSDK(spec, { groupBy: "tag", controllerNames: { 短信管理: "中文" } }), /英文/);
});
test("JSON config rejects typos, wrong shapes and unsafe source schemes", () => {
  assert.deepEqual(parseConfig(JSON.stringify(DEFAULT_CONFIG)), DEFAULT_CONFIG);
  for (const patch of [ { version: 2 }, { input: "" }, { output: 1 }, { hooks: "false" }, { groupBy: "tags" },
    { namesapce: "admin" }, { controllerNames: [] }, { controllerNames: { 用户: "中文" } },
    { input: "file:///etc/passwd" }, { input: "https://user:pass@example.com/openapi.json" }, { namespace: "中文" } ])
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, ...patch }));
  assert.throws(() => parseConfig("{"), /JSON/);
});
test("CLI config paths are relative to config; flags override; --update protects edits, extras and symlinks", async () => {
  const folder = join(dir, "project");
  await mkdir(folder);
  await writeFile(join(folder, "api.json"), JSON.stringify(spec));
  const config = { ...DEFAULT_CONFIG, input: "./api.json", output: "./src/sdk", groupBy: "tag", controllerNames: { 短信管理: "sms" } };
  const file = join(folder, "chainspec.config.json");
  await writeFile(file, JSON.stringify(config));
  let result = await run(["--config", file]);
  assert.equal(result.status, 0, result.stderr);
  const output = join(folder, "src/sdk");
  assert.equal(JSON.parse(await readFile(join(output, "manifest.json"))).operations[0].controller, "sms");
  assert.equal((await run(["--config", file])).status, 1);
  result = await run(["--config", file, "--update", "--namespace", "admin", "--no-hooks"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(join(output, "manifest.json"))).namespace, "admin");
  await assert.rejects(readFile(join(output, "hooks.ts")), { code: "ENOENT" });
  const original = await readFile(join(output, "client.ts"), "utf8");
  await writeFile(join(output, "client.ts"), original + "// custom\n");
  result = await run(["--config", file, "--update"]);
  assert.equal(result.status, 1); assert.match(result.stderr, /changed/);
  assert((await readFile(join(output, "client.ts"), "utf8")).endsWith("// custom\n"));
  await writeFile(join(output, "client.ts"), original);
  await writeFile(join(output, "custom.ts"), "keep me");
  assert.match((await run(["--config", file, "--update"])).stderr, /extra files/);
  await rm(join(output, "custom.ts"));
  await symlink(output, join(dir, "linked"));
  assert.match((await run(["--config", file, "--out", "./linked", "--update"])).stderr, /symlink/);
  result = await run(["--config", file, "--out", "./flag-output", "--namespace", "custom"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(join(dir, "flag-output", "manifest.json"))).namespace, "custom");
});
test("URL loader and installed-style CLI fetch JSON, reject HTML/HTTP/oversize, preserve cancellation", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/bad") { res.writeHead(401); res.end("unauthorized"); }
    else if (req.url === "/html") { res.end("<html>Swagger UI</html>"); }
    else if (req.url === "/huge") { res.writeHead(200, { "content-length": MAX_BYTES + 1 }); res.end(); }
    else if (req.url === "/stream-huge") { res.write(" ".repeat(MAX_BYTES)); res.end(" "); }
    else { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(spec)); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(JSON.parse(await fetchDocument(base + "/api-json")).openapi, "3.0.3");
    const result = await run(["--in", base + "/api-json", "--out", "./remote-sdk", "--group-by", "tag"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, "remote-sdk/manifest.json"))).operations.length, 2);
    await assert.rejects(fetchDocument(base + "/bad"), /401/);
    await assert.rejects(fetchDocument(base + "/html"), /JSON/);
    await assert.rejects(fetchDocument(base + "/huge"), /8 MiB/);
    await assert.rejects(fetchDocument(base + "/stream-huge"), /8 MiB/);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(fetchDocument(base, abort.signal), { name: "AbortError" });
    await assert.rejects(fetchDocument("file:///etc/passwd"), /HTTP/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

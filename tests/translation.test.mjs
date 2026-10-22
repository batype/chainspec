import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { generateSDKAsync, generateSDK, resolveControllerNames, parseConfig, parseControllerNames, englishControllerName, TranslationError } from "../lib/core/index.js";
import { createNodeTranslator } from "../bin/translation-provider.mjs";
import { createTranslationServer } from "../bin/translation-server.mjs";
const dir = await mkdtemp(join(tmpdir(), "chainspec-translation-"));
after(() => rm(dir, { recursive: true, force: true }));
const spec = { openapi: "3.0.3", info: { title: "Translation fixture", version: "1" }, paths: {
  "/api/sms/send": { post: { operationId: "send", tags: ["短信管理", "仅第二个Tag"], responses: { 204: { description: "OK" } } } },
  "/api/sms/list": { get: { operationId: "list", tags: ["短信管理"], responses: { 204: { description: "OK" } } } },
  "/api/user/list": { get: { operationId: "list", tags: ["用户管理"], responses: { 204: { description: "OK" } } } },
} };
const baseConfig = { version: 1, input: "./api.json", output: "./sdk", groupBy: "tag" };

test("auto names only translate missing first groups, reuse cache, preserve overrides and never cache failure fallbacks", async () => {
  const calls = [];
  const one = await generateSDKAsync(spec, { groupBy: "tag", controllerNames: { 用户管理: "users" } }, {
    translate: async (name) => { calls.push(name); return "SMS Management"; },
  });
  assert.deepEqual(calls, ["短信管理"]);
  assert.deepEqual(one.controllerNames, { 用户管理: "users", 短信管理: "smsManagement" });
  assert.equal(JSON.parse(one.files["controller-names.json"])["短信管理"], "smsManagement");
  const two = await generateSDKAsync(spec, { groupBy: "tag", controllerNames: one.controllerNames }, {
    translate: async () => { throw Error("cached names must not request translation"); },
  });
  assert.deepEqual(two.operations.map(op => op.id), one.operations.map(op => op.id));
  assert(!two.diagnostics.some(d => d.code.startsWith("translation-")));
  let attempted = 0;
  const partial = await generateSDKAsync(spec, { groupBy: "tag" }, {
    translate: async () => { if (++attempted === 2) throw Error("provider unavailable"); return "First Group"; },
  });
  assert.equal(Object.keys(partial.controllerNames).length, 1);
  assert(partial.diagnostics.some(d => d.code === "translation-unavailable"));
  assert(JSON.parse(partial.files["manifest.json"]).diagnostics.some(d => d.code === "translation-unavailable"));
  const failedTag = partial.operations.find(op => !Object.hasOwn(partial.controllerNames, op.originalController)).originalController;
  assert(!Object.hasOwn(partial.controllerNames, failedTag));
  let retryCalls = 0;
  await generateSDKAsync(spec, { groupBy: "tag", controllerNames: partial.controllerNames }, {
    translate: async () => { retryCalls++; return "Retried Group"; },
  });
  assert.equal(retryCalls, 1);
  assert.equal(englishControllerName("SMS Management"), "smsManagement");
  assert.equal(englishControllerName("API user-group"), "apiUserGroup");
  assert.throws(() => englishControllerName("中文"));
  assert.throws(() => parseControllerNames({ "": "empty" }));
  const offline = generateSDK(spec, { groupBy: "tag" });
  assert.deepEqual(offline.controllerNames, {});
  const reserved = structuredClone(spec); reserved.paths["/api/user/list"].get.tags = ["constructor"];
  assert(generateSDK(reserved, { groupBy: "tag", controllerNames: {} }).operations.some(op => op.controller === "constructorApi"));
});

test("cached collision suffixes remain stable and cancellation/offline mode do not send names", async () => {
  const first = await generateSDKAsync(spec, { groupBy: "tag" }, { translate: async () => "Management" });
  assert.equal(new Set(first.operations.map(op => op.controller)).size, 2);
  const second = await generateSDKAsync(spec, { groupBy: "tag", controllerNames: first.controllerNames }, { translate: async () => { throw Error("must use cache"); } });
  assert.deepEqual(first.controllerNames, second.controllerNames);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(resolveControllerNames(spec, { groupBy: "tag" }, { signal: abort.signal, translate: async () => { throw Error("should not call"); } }), { name: "AbortError" });
  const offline = await generateSDKAsync(spec, { groupBy: "tag", translateNames: false }, { translate: async () => { throw Error("offline"); } });
  assert(!offline.diagnostics.some(d => d.code.startsWith("translation-")));
});

test("provider configs reject plaintext keys/typos; missing paid credentials fail safely and do not contact fallback services", async () => {
  for (const translation of [ { provider: "unknown" }, { provider: "google", apiKey: "not-a-real-key" }, { provider: "baidu", apiKeyEnv: "bad-name" }, { provider: "youdao", proxyUrl: "https://user:pass@example.com" } ])
    assert.throws(() => parseConfig({ ...baseConfig, translation }));
  let calls = 0;
  const translate = createNodeTranslator({ provider: "google" }, {}, async () => { calls++; throw Error("unexpected"); });
  const project = await generateSDKAsync(spec, { groupBy: "tag", translation: { provider: "google" } }, { translate });
  assert.equal(calls, 0);
  assert(project.diagnostics.some(d => d.message.includes("GOOGLE_TRANSLATE_API_KEY")));
  const browser = await generateSDKAsync(spec, { groupBy: "tag", translation: { provider: "baidu" } });
  assert(browser.diagnostics.some(d => d.message.includes("代理")));
});

test("official Baidu MD5, Youdao v3 SHA256 and Google v2 adapters use the documented protocols without exposing secrets", async () => {
  const fakeKey = "TEST_ONLY_NOT_A_REAL_KEY", fakeApp = "TEST_APP";
  for (const provider of ["baidu", "youdao", "google"]) {
    const translate = createNodeTranslator({ provider, apiKeyEnv: "TEST_KEY", appIdEnv: "TEST_APP" }, { TEST_KEY: fakeKey, TEST_APP: fakeApp }, async (url, options) => {
      const body = new URLSearchParams(options.body);
      assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
      assert.equal(body.get("q"), "短信管理");
      if (provider === "baidu") {
        assert.equal(url.href, "https://fanyi-api.baidu.com/api/trans/vip/translate");
        assert.equal(body.get("appid"), fakeApp);
        assert.equal(body.get("sign"), createHash("md5").update(fakeApp + body.get("q") + body.get("salt") + fakeKey).digest("hex"));
        assert(!options.body.toString().includes(fakeKey));
        return Response.json({ trans_result: [{ dst: "SMS Management" }] });
      }
      if (provider === "youdao") {
        assert.equal(url.href, "https://openapi.youdao.com/api");
        assert.equal(body.get("signType"), "v3"); assert.equal(body.get("from"), "zh-CHS");
        assert.equal(body.get("sign"), createHash("sha256").update(fakeApp + body.get("q") + body.get("salt") + body.get("curtime") + fakeKey).digest("hex"));
        return Response.json({ errorCode: "0", translation: ["SMS Management"] });
      }
      assert.equal(url.origin, "https://translation.googleapis.com");
      assert.equal(url.searchParams.get("key"), fakeKey);
      assert.equal(body.get("target"), "en"); assert.equal(body.get("format"), "text");
      return Response.json({ data: { translations: [{ translatedText: "SMS Management" }] } });
    });
    assert.equal(await translate("短信管理"), "SMS Management");
  }
  const long = "前".repeat(21) + "后".repeat(10);
  const longAdapter = createNodeTranslator({ provider: "youdao", apiKeyEnv: "K", appIdEnv: "A" }, { K: fakeKey, A: fakeApp }, async (_, options) => {
    const p = new URLSearchParams(options.body), chars = Array.from(long);
    const input = chars.slice(0, 10).join("") + chars.length + chars.slice(-10).join("");
    assert.equal(p.get("sign"), createHash("sha256").update(fakeApp + input + p.get("salt") + p.get("curtime") + fakeKey).digest("hex"));
    return Response.json({ errorCode: "0", translation: ["Long Group"] });
  });
  assert.equal(await longAdapter(long), "Long Group");
  const unsafe = createNodeTranslator({ provider: "google", apiKeyEnv: "K" }, { K: fakeKey }, async () => { throw Error(`transport url?key=${fakeKey}`); });
  await assert.rejects(unsafe("短信管理"), e => e instanceof TranslationError && !e.message.includes(fakeKey));
});

test("local proxy only accepts the configured origin/provider and never receives browser credentials", async () => {
  const seen = [];
  const server = createTranslationServer({ provider: "baidu" }, "https://batype.github.io", async text => { seen.push(text); return "SMS Management"; });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/translate`;
  try {
    assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ text: "短信管理", provider: "baidu" }) })).status, 403);
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://batype.github.io" } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "https://batype.github.io");
    const response = await fetch(url, { method: "POST", headers: { Origin: "https://batype.github.io", "Content-Type": "application/json" }, body: JSON.stringify({ text: "短信管理", provider: "baidu" }) });
    assert.equal((await response.json()).translatedText, "SMS Management");
    const mismatch = await fetch(url, { method: "POST", headers: { Origin: "https://batype.github.io", "Content-Type": "application/json" }, body: JSON.stringify({ text: "短信管理", provider: "google" }) });
    assert.equal(mismatch.status, 400); assert.deepEqual(seen, ["短信管理"]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("CLI writes translated names back to config, then regenerates offline from cache with overrides", async () => {
  const source = join(dir, "api.json"), configPath = join(dir, "chainspec.config.json"), countPath = join(dir, "calls.txt");
  await writeFile(source, JSON.stringify(spec));
  await writeFile(configPath, JSON.stringify({ ...baseConfig, translation: { provider: "google", apiKeyEnv: "MOCK_KEY" } }));
  await writeFile(join(dir, ".env"), "MOCK_KEY=TEST_ONLY_NOT_A_REAL_KEY\n");
  const preload = join(dir, "mock-fetch.mjs");
  await writeFile(preload, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch=async (url,options)=>{if(new URL(url).hostname!=='translation.googleapis.com')throw Error('unexpected URL');appendFileSync(${JSON.stringify(countPath)},'call\\n');const p=new URLSearchParams(options.body);return Response.json({data:{translations:[{translatedText:p.get('q')==='短信管理'?'SMS Management':'User Management'}]}});};`);
  async function run() {
    const child = spawn(process.execPath, ["--import", preload, resolve("bin/chainspec.mjs"), "--config", configPath, "--update"], { cwd: dir, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", c => stdout += c); child.stderr.on("data", c => stderr += c);
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr); return stdout;
  }
  assert((await run()).includes("Saved English group names"));
  let config = JSON.parse(await readFile(configPath));
  assert.equal(config.controllerNames["短信管理"], "smsManagement");
  assert.equal((await readFile(countPath, "utf8")).trim().split("\n").length, 2);
  await rm(join(dir, ".env"));
  config.controllerNames["短信管理"] = "sms"; await writeFile(configPath, JSON.stringify(config));
  await run();
  assert.equal((await readFile(countPath, "utf8")).trim().split("\n").length, 2);
  const manifest = JSON.parse(await readFile(join(dir, "sdk/manifest.json")));
  assert(manifest.operations.some(op => op.id === "main.sms.send"));
  assert(!(await readFile(join(dir, "sdk/client.ts"), "utf8")).includes("TEST_ONLY_NOT_A_REAL_KEY"));
});

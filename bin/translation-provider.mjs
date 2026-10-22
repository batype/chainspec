import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseTranslationConfig, translateWithMyMemory, TranslationError, readTranslationResponse } from "../lib/core/index.js";

/** Official provider adapters. Secrets are read lazily and never returned or logged. */
export function createNodeTranslator(config = { provider: "mymemory" }, env = process.env, transport = fetch) {
  const options = parseTranslationConfig(config);
  let nextStart = 0;
  const required = (key) => {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) throw new TranslationError(`缺少环境变量 ${key}，请在本地 .env 或系统环境变量中配置。`);
    return value;
  };
  return async (text, signal) => {
    signal?.throwIfAborted();
    if (typeof text !== "string" || !text || Buffer.byteLength(text) > 500)
      throw new TranslationError("自动翻译仅接受 500 字节以内的分组名称。");
    if (options.provider === "mymemory") return translateWithMyMemory(text, signal);
    const key = required(options.apiKeyEnv);
    const appId = options.provider === "google" ? undefined : required(options.appIdEnv);
    if (options.provider === "baidu") {
      const now = Date.now(), start = Math.max(now, nextStart);
      nextStart = start + 1100;
      if (start > now) await delay(start - now, undefined, { signal });
    }
    const salt = randomUUID().replaceAll("-", "");
    let url, body;
    if (options.provider === "google") {
      url = new URL("https://translation.googleapis.com/language/translate/v2");
      url.searchParams.set("key", key);
      body = new URLSearchParams({ q: text, source: "zh-CN", target: "en", format: "text" });
    } else if (options.provider === "baidu") {
      url = new URL("https://fanyi-api.baidu.com/api/trans/vip/translate");
      const sign = createHash("md5").update(appId + text + salt + key, "utf8").digest("hex");
      body = new URLSearchParams({ q: text, from: "zh", to: "en", appid: appId, salt, sign });
    } else {
      url = new URL("https://openapi.youdao.com/api");
      const curtime = String(Math.floor(Date.now() / 1000));
      const chars = Array.from(text);
      const input = chars.length <= 20 ? text : chars.slice(0, 10).join("") + chars.length + chars.slice(-10).join("");
      const sign = createHash("sha256").update(appId + input + salt + curtime + key, "utf8").digest("hex");
      body = new URLSearchParams({ q: text, from: "zh-CHS", to: "en", appKey: appId, salt, curtime, sign, signType: "v3" });
    }
    let data;
    try {
      const response = await transport(url, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
        redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
        signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) { await response.body?.cancel(); throw Error("HTTP failure"); }
      data = await readTranslationResponse(response);
    } catch {
      signal?.throwIfAborted();
      throw new TranslationError("翻译服务请求失败，请检查网络、密钥权限和额度。");
    }
    const result = options.provider === "google" ? data?.data?.translations?.[0]?.translatedText
      : options.provider === "baidu" ? (!data.error_code ? data?.trans_result?.[0]?.dst : undefined)
      : (String(data.errorCode) === "0" ? data?.translation?.[0] : undefined);
    if (typeof result !== "string" || !result.trim())
      throw new TranslationError("翻译服务未返回译文，请检查应用 ID、密钥、服务开通状态及额度。");
    return result;
  };
}

import type { Diagnostic, GeneratorOptions, Json } from "./model.js";
import { normalize, parseDocument } from "./parse.js";
import { parseControllerNames, parseTranslationConfig } from "./config.js";

export type TranslationControls = {
  signal?: AbortSignal;
  /** Optional adapter for self-hosted translation or offline tests. */
  translate?: (name: string, signal?: AbortSignal) => Promise<string>;
  onProgress?: (progress: { current: number; total: number }) => void;
};
/** Only these locally authored messages may be shown; provider errors may contain credentials. */
export class TranslationError extends Error {}
export function englishControllerName(text: string): string {
  const decoded = text.replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/g, (entity) =>
    ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " })[entity]!);
  if (decoded.length > 200 || /[^\x20-\x7E]/.test(decoded) || !/[A-Za-z]/.test(decoded))
    throw new Error("翻译结果不是有效英文名称");
  const words = decoded.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  let name = words.map((word, i) => {
    const lower = word.toLowerCase();
    return i ? lower[0].toUpperCase() + lower.slice(1) : lower;
  }).join("");
  if (!/^[A-Za-z]/.test(name)) name = "_" + name;
  if (["constructor", "prototype", "__proto__", "then"].includes(name)) name += "Api";
  return name;
}

/** GET only: never contributes source text to a translation memory. */
export async function translateWithMyMemory(name: string, signal?: AbortSignal): Promise<string> {
  if (new TextEncoder().encode(name).length > 500) throw new Error("单个分组名称超过免费接口 500 字节限制");
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", name);
  url.searchParams.set("langpair", "zh-CN|en");
  const response = await fetch(url, {
    credentials: "omit", referrerPolicy: "no-referrer",
    signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("免费翻译服务暂不可用或已限流"); }
  if (!response.body) throw new Error("翻译服务返回为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128 * 1024) throw new Error("翻译响应过大");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(joined));
  if (data.quotaFinished || Number(data.responseStatus) !== 200 || typeof data.responseData?.translatedText !== "string")
    throw new Error("免费翻译额度已用完或服务暂不可用");
  return data.responseData.translatedText;
}

export async function translateViaProxy(name: string, options: GeneratorOptions, signal?: AbortSignal): Promise<string> {
  const config = parseTranslationConfig(options.translation ?? { provider: "mymemory" });
  if (!config.proxyUrl) throw new TranslationError("该翻译服务需要配置浏览器代理地址；可先运行 chainspec translate-server，或直接使用 CLI 生成。");
  const response = await fetch(config.proxyUrl, {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: name, provider: config.provider }),
    signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
  });
  const data = await readTranslationResponse(response);
  if (!response.ok || typeof data.translatedText !== "string")
    throw new TranslationError("翻译代理调用失败，请检查代理服务、环境变量密钥和所选服务是否一致。");
  return data.translatedText;
}

export async function readTranslationResponse(response: Response): Promise<any> {
  if (!response.body) throw new Error("Empty translation response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128 * 1024) throw new Error("Translation response too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function resolveControllerNames(
  input: string | Json,
  options: GeneratorOptions = {},
  controls: TranslationControls = {},
): Promise<{ controllerNames: Record<string, string>; diagnostics: Diagnostic[] }> {
  const controllerNames = parseControllerNames(options.controllerNames ?? {});
  const diagnostics: Diagnostic[] = [];
  if (options.translateNames === false) return { controllerNames, diagnostics };
  const operations = normalize(parseDocument(input), options, []).operations;
  const missing = [...new Set(operations.map((op) => op.originalController))]
    .filter((name) => /\p{Script=Han}/u.test(name) && !Object.hasOwn(controllerNames, name)).sort();
  const config = parseTranslationConfig(options.translation ?? { provider: "mymemory" });
  const translate = controls.translate ?? (config.provider === "mymemory"
    ? translateWithMyMemory : (name, signal) => translateViaProxy(name, options, signal));
  let characters = 0;
  for (let i = 0; i < missing.length; i++) {
    controls.signal?.throwIfAborted();
    const name = missing[i];
    if (i >= 100 || characters + name.length > 5000) {
      diagnostics.push({ level: "warning", code: "translation-limit", message: "本次自动翻译达到分组/字符上限，剩余分组按路径命名；成功结果已缓存。" });
      break;
    }
    controls.onProgress?.({ current: i + 1, total: missing.length });
    if (new TextEncoder().encode(name).length > 500) {
      diagnostics.push({ level: "warning", code: "translation-name-too-long", message: "分组名称超过自动翻译长度限制，已按路径命名。", location: name });
      continue;
    }
    characters += name.length;
    let translated: string;
    try { translated = await translate(name, controls.signal); }
    catch (error) {
      controls.signal?.throwIfAborted();
      diagnostics.push({ level: "warning", code: "translation-unavailable", message: error instanceof TranslationError
        ? error.message : "翻译服务不可用、鉴权失败或额度用完；已保留成功缓存，其余分组按路径命名。", location: name });
      break;
    }
    try { controllerNames[name] = englishControllerName(translated); }
    catch {
      diagnostics.push({ level: "warning", code: "translation-invalid", message: "服务未返回有效英文名称，已按路径命名；下次可以重试。", location: name });
    }
  }
  return { controllerNames, diagnostics };
}

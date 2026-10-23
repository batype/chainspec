import { MAX_BYTES } from "./model.js";
import { parseDocument } from "./parse.js";
import { documentURL } from "./config.js";
import type { DocumentRequestOptions } from "./source-config.js";

/** Only called after an explicit URL import / CLI invocation. Never fetches refs. */
export async function fetchDocument(input: string, signal?: AbortSignal, options: DocumentRequestOptions = {}): Promise<string> {
  const url = documentURL(input);
  const abort = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  let headers: Headers;
  try { headers = new Headers(options.headers); }
  catch { throw new Error("请求头配置不合法，请检查名称与值"); }
  const credentialed = Array.from(headers).length > 0 || options.credentials === "include";
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET", credentials: options.credentials ?? "omit", referrerPolicy: "no-referrer",
      redirect: credentialed ? "error" : "follow", headers, signal: abort,
    });
  } catch {
    abort.throwIfAborted();
    throw new Error(credentialed
      ? "无法读取文档：请检查网络、CORS 或登录跳转；携带凭据时请使用最终 JSON 地址，不跟随重定向。"
      : "无法读取文档：请检查网络、HTTPS 与 CORS，或使用 CLI / 文件导入。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`获取文档失败：HTTP ${response.status}${response.status === 401 || response.status === 403 ? "，请检查认证方式、凭据和文档访问权限" : ""}`);
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("远程文档最大 8 MiB");
  }
  if (!response.body) throw new Error("远程文档为空");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("远程文档最大 8 MiB");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  parseDocument(text);
  return text;
}

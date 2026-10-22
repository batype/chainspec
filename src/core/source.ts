import { MAX_BYTES } from "./model.js";
import { parseDocument } from "./parse.js";
import { documentURL } from "./config.js";

/** Only called after an explicit URL import / CLI invocation. Never fetches refs. */
export async function fetchDocument(input: string, signal?: AbortSignal): Promise<string> {
  const url = documentURL(input);
  const abort = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  const response = await fetch(url, {
    method: "GET", credentials: "omit", referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" }, signal: abort,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`获取文档失败：HTTP ${response.status}`);
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

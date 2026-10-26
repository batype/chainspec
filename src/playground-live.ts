/** Browser debugging settings stay in React memory, outside exported SDK/config/workspaces. */
export type LiveConnection = {
  baseUrl: string;
  auth: "none" | "bearer" | "basic";
  token: string;
  username: string;
  password: string;
  credentials: boolean;
};
export const liveConnection = (baseUrl: string): LiveConnection => ({
  baseUrl, auth: "none", token: "", username: "", password: "", credentials: false,
});
export function validateConnection(value: LiveConnection) {
  let url: URL;
  try { url = new URL(value.baseUrl); } catch { throw Error("请在请求设置中填写完整的 HTTP(S) 业务地址；文档中的相对路径需要补充域名。"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || /[{}\r\n]/.test(value.baseUrl))
    throw Error("业务地址应为无账号密码、查询参数和占位符的 HTTP(S) 地址。");
  if (value.auth === "bearer" && !value.token.trim()) throw Error("请填写 Bearer Token");
  if (value.auth === "basic" && (!value.username || value.username.includes(":"))) throw Error("请填写 Basic 用户名，且不能包含冒号");
  connectionHeaders(value);
}
export function connectionHeaders(value: LiveConnection): Record<string, string> {
  const headers: Record<string, string> = {};
  if (value.auth === "bearer") headers.Authorization = `Bearer ${value.token.trim().replace(/^Bearer\s+/i, "")}`;
  if (value.auth === "basic") {
    const bytes = new TextEncoder().encode(`${value.username}:${value.password}`);
    headers.Authorization = `Basic ${btoa(Array.from(bytes, v => String.fromCharCode(v)).join(""))}`;
  }
  new Headers(headers);
  return headers;
}
export type LiveResponseInfo = { status: number; statusText: string; headers: Record<string,string>; duration: number };
/** Retains the SDK's default serializer/parser; limits only the browser preview transport. */
export function createLiveFetch(
  connection: LiveConnection,
  controllers: Set<AbortController>,
  onResponse: (info: LiveResponseInfo) => void,
  fetcher: typeof fetch = globalThis.fetch,
  limits = { timeout: 30000, bytes: 8 * 1024 * 1024 },
): typeof fetch {
  return async (input, init) => {
    validateConnection(connection);
    const controller = new AbortController();
    controllers.add(controller);
    const start = performance.now();
    const timer = setTimeout(() => controller.abort(new DOMException("请求超过 30 秒，请检查服务或在工程中使用 SDK", "TimeoutError")), limits.timeout);
    try {
      const response = await fetcher(input, {
        ...init, credentials: connection.credentials ? "include" : "omit", redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      });
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body?.getReader();
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > limits.bytes) { await reader.cancel(); throw Error("响应超过 8 MiB 预览限制，请在工程中使用 SDK"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      onResponse({status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), duration: Math.round(performance.now()-start)});
      return new Response([101,204,205,304].includes(response.status) || init?.method === "HEAD" ? null : bytes, {status:response.status,statusText:response.statusText,headers:response.headers});
    } finally { clearTimeout(timer); controllers.delete(controller); }
  };
}
export function liveError(error: unknown): string {
  if (error instanceof TypeError) return `${error.message}。浏览器网络请求失败：请检查业务地址、CORS、HTTPS/混合内容、网络连接及重定向；工具无法绕过服务端跨域限制。`;
  return error instanceof Error ? error.message : "请求失败";
}

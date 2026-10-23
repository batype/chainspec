import { useEffect, useRef, useState } from "react";
import { documentURL } from "../core/config";
import { parseSourceRequest, type SourceRequestConfig } from "../core/source-config";

type Props = {
  input: string;
  request?: SourceRequestConfig;
  loading: boolean;
  onLoad: (url: string, request: SourceRequestConfig, values: Record<string, string>) => Promise<boolean>;
  onSave: (url: string, request: SourceRequestConfig) => void;
  onClose: () => void;
};
export default function SourceDialog({ input, request, loading, onLoad, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const [url, setUrl] = useState(/^https?:\/\//i.test(input) ? input : "");
  const [auth, setAuth] = useState<"none" | "basic" | "bearer">(request?.auth?.type ?? "none");
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [token, setToken] = useState("");
  const [usernameEnv, setUsernameEnv] = useState(request?.auth?.type === "basic" ? request.auth.usernameEnv : "OPENAPI_USERNAME");
  const [passwordEnv, setPasswordEnv] = useState(request?.auth?.type === "basic" ? request.auth.passwordEnv : "OPENAPI_PASSWORD");
  const [tokenEnv, setTokenEnv] = useState(request?.auth?.type === "bearer" ? request.auth.tokenEnv : "OPENAPI_TOKEN");
  const [includeCookies, setIncludeCookies] = useState(request?.credentials === "include");
  const [headers, setHeaders] = useState(() => Object.entries(request?.headersEnv ?? {}).map(([name, env]) => ({ name, env, value: "" })));
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); urlInput.current?.focus(); }, []);
  useEffect(() => { if (error) errorMessage.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const close = () => { dialog.current?.close(); onClose(); };
  const connection = () => {
    documentURL(url.trim());
    const seen = new Set<string>();
    for (const h of headers) {
      const name = h.name.toLowerCase();
      if (seen.has(name)) throw Error("请求头名称重复（不区分大小写）");
      seen.add(name);
      if (["cookie", "host", "origin", "referer", "content-length", "connection", "accept-encoding", "access-control-request-method", "access-control-request-headers"].includes(name) || name.startsWith("sec-") || name.startsWith("proxy-"))
        throw Error("该请求头由浏览器管理；Cookie 登录请勾选“携带已有登录 Cookie”，或使用 CLI 配置 headersEnv。");
    }
    return parseSourceRequest({
      ...(auth === "basic" ? { auth: { type: "basic", usernameEnv, passwordEnv } } : auth === "bearer" ? { auth: { type: "bearer", tokenEnv } } : {}),
      ...(headers.length ? { headersEnv: Object.fromEntries(headers.map(h => [h.name, h.env])) } : {}),
      ...(includeCookies ? { credentials: "include" } : {}),
    });
  };
  const submit = async (fetchNow: boolean) => {
    setError("");
    try {
      const config = connection();
      if (!fetchNow) { onSave(url.trim(), config); close(); return; }
      const values: Record<string, string> = {};
      const add = (env: string, value: string) => {
        if (Object.hasOwn(values, env) && values[env] !== value) throw Error("同一环境变量名对应了不同凭据，请在 CLI 配置中使用不同名称。");
        values[env] = value;
      };
      if (auth === "basic") { add(usernameEnv, username); add(passwordEnv, password); }
      if (auth === "bearer") add(tokenEnv, token);
      for (const h of headers) add(h.env, h.value);
      if (await onLoad(url.trim(), config, values)) close();
    } catch (e) { setError(e instanceof Error ? e.message : "连接配置有误"); }
  };
  return <dialog ref={dialog} className="config-dialog source-dialog" aria-labelledby="source-dialog-title" onCancel={(e) => { e.preventDefault(); close(); }}>
    <div className="config-dialog-heading">
      <div><h2 id="source-dialog-title">文档连接设置</h2><p>从链接获取 OpenAPI JSON，也支持需要认证的文档。</p></div>
      <button type="button" onClick={close} aria-label="关闭连接设置">×</button>
    </div>
    <form onSubmit={(e) => { e.preventDefault(); void submit(true); }}>
      <div className="connection-scroll">
      <fieldset disabled={loading} className="connection-fields">
        <label htmlFor="source-url">OpenAPI JSON 地址<input ref={urlInput} id="source-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/api-json" required spellCheck={false} /></label>
        <label htmlFor="source-auth">认证方式<select id="source-auth" value={auth} onChange={(e) => setAuth(e.target.value as typeof auth)}>
          <option value="none">无需认证</option><option value="basic">Basic · 账号密码</option><option value="bearer">Bearer Token</option>
        </select></label>
        {auth === "basic" && <div className="connection-grid">
          <label htmlFor="source-username">账号<input id="source-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} /></label>
          <label htmlFor="source-password">密码<input id="source-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
        </div>}
        {auth === "bearer" && <label htmlFor="source-token">Token<input id="source-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="只填写 Token，不含 Bearer 前缀" autoComplete="off" /></label>}
        <label className="connection-cookie"><input type="checkbox" checked={includeCookies} onChange={(e) => setIncludeCookies(e.target.checked)} /><span>携带已有登录 Cookie<small>先在目标站登录；能否携带取决于跨域配置和浏览器 Cookie 策略。</small></span></label>
        <details className="connection-extra" open={headers.length > 0 || undefined}>
          <summary>自定义请求头 <small>{headers.length ? `${headers.length} 条` : "API Key、租户标识等"}</small></summary>
          {headers.map((h, i) => <div className="connection-header-row" key={i}>
            <input aria-label={`请求头名称 ${i + 1}`} value={h.name} placeholder="X-API-Key" spellCheck={false} onChange={(e) => setHeaders(headers.map((row, n) => n === i ? { ...row, name: e.target.value } : row))} />
            <input aria-label={`请求头值 ${i + 1}`} value={h.value} type="password" placeholder="本次请求使用的值" autoComplete="off" onChange={(e) => setHeaders(headers.map((row, n) => n === i ? { ...row, value: e.target.value } : row))} />
            <button type="button" aria-label={`删除请求头 ${i + 1}`} onClick={() => setHeaders(headers.filter((_, n) => n !== i))}>×</button>
          </div>)}
          <button type="button" className="add-mapping" disabled={headers.length >= 32} onClick={() => setHeaders([...headers, { name: "", value: "", env: `OPENAPI_HEADER_${headers.length + 1}` }])}>＋ 添加请求头</button>
        </details>
        {(auth !== "none" || headers.length > 0) && <details className="connection-extra">
          <summary>CLI 凭据配置 <small>环境变量名，可直接导出</small></summary>
          <div className="connection-grid">
            {auth === "basic" && <><label htmlFor="source-username-env">账号环境变量<input id="source-username-env" value={usernameEnv} onChange={(e) => setUsernameEnv(e.target.value)} spellCheck={false} /></label><label htmlFor="source-password-env">密码环境变量<input id="source-password-env" value={passwordEnv} onChange={(e) => setPasswordEnv(e.target.value)} spellCheck={false} /></label></>}
            {auth === "bearer" && <label htmlFor="source-token-env">Token 环境变量<input id="source-token-env" value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} spellCheck={false} /></label>}
            {headers.map((h, i) => <label key={i} htmlFor={`source-header-env-${i}`}>{h.name || `请求头 ${i + 1}`} 环境变量<input id={`source-header-env-${i}`} value={h.env} onChange={(e) => setHeaders(headers.map((row, n) => n === i ? { ...row, env: e.target.value } : row))} spellCheck={false} /></label>)}
          </div>
          <p className="config-help">CLI 从环境或配置旁的 .env 读取这些变量。网页需要单独填写本次使用的值。</p>
        </details>}
      </fieldset>
      <p className="connection-note">密码、Token 和请求头值仅用于本次获取，关闭弹窗即清除，不写入缓存、配置或 SDK。连接设置只用于读取文档，生成的 SDK 鉴权由业务代码配置。</p>
      <details className="connection-extra connection-help"><summary>遇到登录或跨域限制？</summary><p>Basic 适用于 HTTP 账号密码认证。表单登录、验证码或 SSO 请先在目标站完成登录，再尝试携带 Cookie。目标站仍需允许当前来源及所用请求头；Cookie 请求还需允许凭据，且浏览器可能禁止第三方 Cookie。无法跨域时可下载 JSON 导入，或在本地使用 CLI。携带凭据的请求不会跟随跳转，请填写最终 JSON 地址。</p></details>
      {error && <p ref={errorMessage} className="config-error" role="alert">{error}</p>}
      </div>
      <div className="config-dialog-actions">
        <button type="button" onClick={close}>{loading ? "取消获取" : "取消"}</button>
        <button type="button" disabled={loading || !url.trim()} onClick={() => void submit(false)}>保存设置</button>
        <button type="submit" className="primary" disabled={loading || !url.trim()}>{loading ? "获取中…" : "获取并载入"}</button>
      </div>
    </form>
  </dialog>;
}

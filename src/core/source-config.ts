/** Portable document connection settings. Values stay in the runtime environment. */
export type SourceRequestConfig = {
  auth?: { type: "basic"; usernameEnv: string; passwordEnv: string } | { type: "bearer"; tokenEnv: string };
  headersEnv?: Record<string, string>;
  credentials?: "omit" | "include";
};
export type DocumentRequestOptions = { headers?: HeadersInit; credentials?: "omit" | "include" };
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function parseSourceRequest(value: unknown): SourceRequestConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("sourceRequest 必须为对象");
  const v = value as Record<string, any>;
  for (const key of Object.keys(v)) if (!["auth", "headersEnv", "credentials"].includes(key))
    throw Error("文档连接配置只保存认证方式和环境变量名，不能保存密码或 Token");
  if (v.credentials !== undefined && !["omit", "include"].includes(v.credentials)) throw Error("credentials 必须为 omit 或 include");
  if (v.auth !== undefined) {
    const a = v.auth;
    if (!a || typeof a !== "object" || Array.isArray(a) || !["basic", "bearer"].includes(a.type)) throw Error("认证方式需为 basic 或 bearer");
    const fields = a.type === "basic" ? ["usernameEnv", "passwordEnv"] : ["tokenEnv"];
    for (const key of Object.keys(a)) if (key !== "type" && !fields.includes(key)) throw Error("认证配置只能引用环境变量");
    for (const key of fields) if (typeof a[key] !== "string" || !envName.test(a[key])) throw Error(`${key} 需为环境变量名称`);
  }
  if (v.headersEnv !== undefined) {
    if (!v.headersEnv || typeof v.headersEnv !== "object" || Array.isArray(v.headersEnv)) throw Error("headersEnv 必须为请求头到环境变量名的对象");
    const entries = Object.entries(v.headersEnv);
    if (entries.length > 32) throw Error("自定义请求头最多 32 条");
    const seen = new Set<string>();
    for (const [header, variable] of entries) {
      if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(header)) throw Error("请求头名称不合法");
      const lower = header.toLowerCase();
      if (seen.has(lower)) throw Error("请求头名称重复（不区分大小写）");
      seen.add(lower);
      if (v.auth && lower === "authorization") throw Error("Authorization 与所选认证方式重复，请仅保留一种");
      if (typeof variable !== "string" || !envName.test(variable)) throw Error("请求头的值需为环境变量名称");
    }
  }
  return { ...(v.auth ? { auth: { ...v.auth } } : {}), ...(v.headersEnv ? { headersEnv: { ...v.headersEnv } } : {}), ...(v.credentials ? { credentials: v.credentials } : {}) };
}
/** Resolve ephemeral browser values or Node process.env; never write these into config. */
export function sourceRequestOptions(config: SourceRequestConfig = {}, env: Record<string, string | undefined> = {}): DocumentRequestOptions {
  const parsed = parseSourceRequest(config);
  const read = (name: string) => {
    if (!Object.hasOwn(env, name) || env[name] === undefined || env[name] === "") throw Error(`请填写凭据或设置环境变量 ${name}`);
    return env[name]!;
  };
  const headers = new Headers();
  try {
    for (const [header, name] of Object.entries(parsed.headersEnv ?? {})) headers.set(header, read(name));
    if (parsed.auth?.type === "bearer") headers.set("Authorization", `Bearer ${read(parsed.auth.tokenEnv)}`);
    if (parsed.auth?.type === "basic") {
      const username = read(parsed.auth.usernameEnv), password = read(parsed.auth.passwordEnv);
      if (username.includes(":")) throw Error("Basic 用户名不能包含冒号");
      const bytes = new TextEncoder().encode(`${username}:${password}`);
      headers.set("Authorization", `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))}`);
    }
  } catch (error) {
    if (error instanceof TypeError) throw Error("请求头值不合法，请检查是否含换行或不支持的字符");
    throw error;
  }
  return { headers, credentials: parsed.credentials ?? "omit" };
}

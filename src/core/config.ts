import type { GeneratorOptions, TranslationConfig } from "./model.js";

/** Shared by the web editor and CLI. Paths resolve relative to the config file. */
export type ChainSpecConfig = GeneratorOptions & {
  version: 1;
  input: string;
  output: string;
};
export const DEFAULT_CONFIG: ChainSpecConfig = {
  version: 1,
  input: "./openapi.json",
  output: "./src/api",
  namespace: "main",
  groupBy: "path",
  hooks: true,
  controllerNames: {},
  translateNames: true,
  translation: { provider: "mymemory" },
};
const keys = new Set([
  "version", "input", "output", "namespace", "groupBy", "stripPrefix",
  "controllerNames", "baseUrl", "hooks", "translateNames", "translation",
]);
export function parseConfig(input: string | unknown): ChainSpecConfig {
  let value: any = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); }
    catch { throw new Error("配置必须是有效 JSON"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("配置必须是 JSON 对象");
  for (const key of Object.keys(value))
    if (!keys.has(key)) throw new Error(`未知配置项：${key}`);
  if (value.version !== 1) throw new Error("配置 version 必须为 1");
  for (const key of ["input", "output"])
    if (typeof value[key] !== "string" || !value[key].trim())
      throw new Error(`配置 ${key} 必须为非空字符串`);
  for (const key of ["namespace", "stripPrefix", "baseUrl"])
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new Error(`配置 ${key} 必须为字符串`);
  if (value.namespace !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.namespace))
    throw new Error("命名空间需为英文标识符");
  if (value.groupBy !== undefined && !["path", "tag"].includes(value.groupBy))
    throw new Error("groupBy 必须为 path 或 tag");
  if (value.hooks !== undefined && typeof value.hooks !== "boolean")
    throw new Error("hooks 必须为布尔值");
  if (value.translateNames !== undefined && typeof value.translateNames !== "boolean")
    throw new Error("translateNames 必须为布尔值");
  if (value.translation !== undefined) parseTranslationConfig(value.translation);
  if (value.stripPrefix && !value.stripPrefix.startsWith("/"))
    throw new Error("stripPrefix 必须以 / 开头");
  if (value.controllerNames !== undefined) {
    parseControllerNames(value.controllerNames);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value.input)) documentURL(value.input);
  return { ...value, controllerNames: { ...value.controllerNames } };
}

export const TRANSLATION_DEFAULTS: Record<TranslationConfig["provider"], TranslationConfig> = {
  mymemory: { provider: "mymemory" },
  google: { provider: "google", apiKeyEnv: "GOOGLE_TRANSLATE_API_KEY" },
  baidu: { provider: "baidu", appIdEnv: "BAIDU_TRANSLATE_APP_ID", apiKeyEnv: "BAIDU_TRANSLATE_SECRET_KEY" },
  youdao: { provider: "youdao", appIdEnv: "YOUDAO_TRANSLATE_APP_KEY", apiKeyEnv: "YOUDAO_TRANSLATE_SECRET_KEY" },
};
export function parseTranslationConfig(value: unknown): TranslationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("translation 必须为对象");
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v))
    if (!["provider", "apiKeyEnv", "appIdEnv", "proxyUrl"].includes(key))
      throw new Error("翻译配置仅保存 provider、环境变量名和 proxyUrl；真实密钥请放入环境变量");
  if (typeof v.provider !== "string" || !Object.hasOwn(TRANSLATION_DEFAULTS, v.provider))
    throw new Error("翻译服务需为 mymemory、google、baidu 或 youdao");
  for (const key of ["apiKeyEnv", "appIdEnv"])
    if (v[key] !== undefined && (typeof v[key] !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v[key] as string)))
      throw new Error(`${key} 需为环境变量名称`);
  if (v.proxyUrl !== undefined) {
    if (typeof v.proxyUrl !== "string") throw new Error("proxyUrl 需为 HTTP(S) 地址");
    documentURL(v.proxyUrl);
  }
  return { ...TRANSLATION_DEFAULTS[v.provider as TranslationConfig["provider"]], ...v } as TranslationConfig;
}

export function parseControllerNames(input: unknown): Record<string, string> {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > 8 * 1024 * 1024) throw new Error("映射文件最大 8 MiB");
    try { input = JSON.parse(input); } catch { throw new Error("分组映射必须是有效 JSON 对象"); }
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("controllerNames 必须为原分组到英文名称的对象");
  const entries = Object.entries(input);
  if (entries.length > 5000) throw new Error("最多 5000 条分组映射");
  for (const [tag, alias] of entries) {
    if (!tag.trim()) throw new Error("请填写映射的原分组名称");
    if (typeof alias !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias))
      throw new Error("controllerNames 的值必须为英文标识符，例如 sms");
  }
  return Object.fromEntries(entries);
}

export function documentURL(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入完整的 HTTP(S) JSON 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("文档地址仅支持 HTTP(S)，不能包含用户名、密码或片段");
  return url;
}

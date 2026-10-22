import type { GeneratorOptions } from "./model.js";

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
};
const keys = new Set([
  "version", "input", "output", "namespace", "groupBy", "stripPrefix",
  "controllerNames", "baseUrl", "hooks",
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
  if (value.stripPrefix && !value.stripPrefix.startsWith("/"))
    throw new Error("stripPrefix 必须以 / 开头");
  if (value.controllerNames !== undefined) {
    if (!value.controllerNames || typeof value.controllerNames !== "object" || Array.isArray(value.controllerNames))
      throw new Error("controllerNames 必须为原分组到英文名称的对象");
    for (const alias of Object.values(value.controllerNames))
      if (typeof alias !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias))
        throw new Error("controllerNames 的值必须为英文标识符，例如 sms");
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value.input)) documentURL(value.input);
  return { ...value, controllerNames: { ...value.controllerNames } };
}

export function documentURL(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入完整的 HTTP(S) JSON 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("文档地址仅支持 HTTP(S)，不能包含用户名、密码或片段");
  return url;
}

import { parseConfig, type ChainSpecConfig } from "./core/config.js";
import { parseDocument, normalize } from "./core/parse.js";
import type { Diagnostic } from "./core/model.js";
export function generationKey(input: string, configText: string) {
  const { target, hooks, output, ...code } = JSON.parse(configText);
  return JSON.stringify([input, code]);
}
export function configFieldErrors(
  settings: ChainSpecConfig,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    settings.namespace !== undefined &&
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(settings.namespace)
  )
    errors["config-namespace"] = "使用英文标识符，例如 main 或 admin";
  if (settings.stripPrefix && !settings.stripPrefix.startsWith("/"))
    errors["config-prefix"] = "路径前缀应以 / 开头，例如 /v1/api";
  if (!settings.input?.trim())
    errors["config-source"] = "填写文档路径或 JSON 链接";
  if (!settings.output?.trim())
    errors["config-output"] = "填写 SDK 输出目录，例如 ./src/api";
  const base = settings.baseUrl;
  if (base) {
    let valid =
      !/[\r\n?#{}]/.test(base) &&
      !base.startsWith("//") &&
      (base.startsWith("/") || /^https?:\/\//i.test(base));
    if (valid && !base.startsWith("/"))
      try {
        const url = new URL(base);
        valid = !url.username && !url.password;
      } catch {
        valid = false;
      }
    if (!valid)
      errors["config-base"] =
        "填写无查询参数的 HTTP(S) 地址或相对路径，例如 https://api.example.com";
  }
  Object.entries(settings.controllerNames ?? {}).forEach(([tag, name], i) => {
    if (!tag.trim()) errors[`mapping-tag-${i}`] = "填写原始 Tag 名称";
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
      errors[`mapping-name-${i}`] = "填写英文标识符，例如 users";
  });
  return errors;
}
export type DocumentInfo = {
  title: string;
  version: string;
  operations: number;
  schemaCount: number;
  baseUrl: string;
};
/** Invoked only inside the Worker (and tests); no translation or network requests. */
export function inspectDocument(input: string): DocumentInfo {
  const doc = parseDocument(input),
    diagnostics: Diagnostic[] = [];
  const { operations, baseUrl } = normalize(doc, {}, diagnostics);
  return {
    title: String(doc.info?.title ?? "未命名 API"),
    version: String(doc.info?.version ?? ""),
    operations: operations.length,
    schemaCount: Object.keys(doc.components?.schemas ?? doc.definitions ?? {})
      .length,
    baseUrl,
  };
}

export function exportWorkspace(document: string, config: unknown): string {
  if (new TextEncoder().encode(document).length > 8 * 1024 * 1024)
    throw Error("文档最大 8 MiB");
  return JSON.stringify(
    {
      kind: "ChainSpecWorkspace",
      version: 1,
      document,
      config: parseConfig(config),
    },
    null,
    2,
  );
}
export function importWorkspace(text: string): {
  document: string;
  config: ChainSpecConfig;
} {
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024)
    throw Error("工作包最大 32 MiB");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("请选择 ChainSpec 工作包");
  const v = value as Record<string, unknown>;
  if (
    v.kind !== "ChainSpecWorkspace" ||
    v.version !== 1 ||
    typeof v.document !== "string"
  )
    throw Error("工作包格式不正确，请使用保存工作包导出的 JSON");
  if (new TextEncoder().encode(v.document).length > 8 * 1024 * 1024)
    throw Error("文档最大 8 MiB");
  return { document: v.document, config: parseConfig(v.config) };
}

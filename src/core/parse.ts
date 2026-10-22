import { MAX_BYTES, MAX_OPERATIONS } from "./model.js";
import type {
  Json,
  GeneratorOptions,
  Diagnostic,
  Operation,
  Parameter,
} from "./model.js";
import { resolve } from "./schema.js";
export const METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
];
const reserved = new Set(["__proto__", "prototype", "constructor", "then"]);
export function nameOf(value: string, fallback = "endpoint"): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
  let result =
    words
      .map((w, i) =>
        i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1),
      )
      .join("") || fallback;
  if (!/^[A-Za-z_$]/.test(result)) result = "_" + result;
  return reserved.has(result) ? result + "Api" : result;
}
function hash(value: string) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
export function parseDocument(input: string | Json): Json {
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_BYTES)
      throw new Error("JSON最大8 MiB");
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("请输入有效JSON；Swagger UI网页HTML或YAML不能直接导入");
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("文档必须是JSON对象");
  if (input.swagger !== "2.0" && !/^3\.[01]\./.test(String(input.openapi)))
    throw new Error(
      "首版支持Swagger 2.0、OpenAPI 3.0/3.1 JSON；其他版本请先转换",
    );
  if (
    !input.paths ||
    typeof input.paths !== "object" ||
    Array.isArray(input.paths)
  )
    throw new Error("缺少有效paths对象");
  return input;
}
export function normalize(
  doc: Json,
  options: GeneratorOptions,
  diagnostics: Diagnostic[],
) {
  const namespace = options.namespace ?? "main";
  if (
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(namespace) ||
    reserved.has(namespace)
  )
    throw new Error("命名空间需是有效标识符，不能使用保留的对象属性");
  const candidates = [
    "/v1/api",
    "/v2/api",
    "/api/v1",
    "/api/v2",
    "/api",
    "/v1",
    "/v2",
  ];
  const inferred =
    candidates.find((p) =>
      Object.keys(doc.paths).every((path) => path.startsWith(p + "/")),
    ) ?? "";
  const prefix = options.stripPrefix ?? inferred;
  if (prefix && !prefix.startsWith("/")) throw new Error("路径前缀需以/开头");
  const operations: Operation[] = [];
  const used = new Set<string>();
  const groupSources = new Map<string, string>();
  const assignedGroups = new Map<string, string>();
  for (const path of Object.keys(doc.paths).sort()) {
    if (!path.startsWith("/") || path.includes("?") || path.includes("#"))
      throw new Error("paths中的路径需以/开头且不能包含query/hash");
    const item = resolve(doc, doc.paths[path]);
    for (const method of METHODS) {
      const raw = item?.[method];
      if (!raw) continue;
      const op = resolve(doc, raw);
      if (!op || typeof op !== "object") throw new Error("Invalid operation");
      const tags = Array.isArray(op.tags)
        ? op.tags.filter((x: unknown) => typeof x === "string")
        : [];
      const stripped =
        prefix && (path === prefix || path.startsWith(prefix + "/"))
          ? path.slice(prefix.length)
          : path;
      const pathGroup =
        stripped.split("/").filter((s: string) => s && !s.startsWith("{"))[0] ??
        "default";
      const originalGroup =
        op["x-sdk-controller"] ??
        (options.groupBy === "tag" ? (tags[0] ?? pathGroup) : pathGroup);
      const alias = Object.hasOwn(options.controllerNames ?? {}, originalGroup)
        ? options.controllerNames![originalGroup] : undefined;
      if (alias !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias))
        throw new Error(`分组「${originalGroup}」的别名需为英文标识符`);
      let controller = assignedGroups.get(originalGroup) ?? nameOf(
        alias ?? (/^[\x00-\x7F]+$/.test(originalGroup) ? originalGroup : pathGroup),
        "group_" + hash(originalGroup),
      );
      if (!assignedGroups.has(originalGroup) && alias === undefined && /[^\x00-\x7F]/.test(originalGroup))
        diagnostics.push({
          level: "warning", code: "group-name-fallback",
          message: `分组「${originalGroup}」使用路径推导名称 ${controller}；可在 controllerNames 中显式映射`,
          location: path,
        });
      if (
        groupSources.has(controller) &&
        groupSources.get(controller) !== originalGroup
      ) {
        controller += "_" + hash(originalGroup);
        diagnostics.push({
          level: "warning",
          code: "group-collision",
          message: "分组规范化重名，已添加稳定后缀",
          location: path,
        });
      }
      groupSources.set(controller, originalGroup);
      assignedGroups.set(originalGroup, controller);
      const originalId =
        typeof op.operationId === "string" ? op.operationId : undefined;
      const methodSource = method + " " + stripped.replace(/\{([^}]+)\}/g, "by $1");
      let name = nameOf(originalId && /^[\x00-\x7F]+$/.test(originalId) ? originalId : methodSource);
      if (used.has(`${controller}.${name}`)) {
        name += "_" + method + "_" + hash(path);
        diagnostics.push({
          level: "warning",
          code: "operation-collision",
          message: "分组内方法重名，已追加HTTP方法与稳定路径后缀",
          location: path,
        });
      }
      used.add(`${controller}.${name}`);
      const params = new Map<string, any>();
      for (const p of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const v = resolve(doc, p);
        if (!v?.name || !v?.in) throw new Error(`Invalid parameter at ${path}`);
        params.set(v.in + ":" + v.name, v);
      }
      const parameters: Parameter[] = [];
      let body: Operation["body"];
      const form: Json = { type: "object", properties: {}, required: [] };
      for (const p of params.values()) {
        if (p.in === "body") {
          body = {
            schema: p.schema,
            required: p.required === true,
            mediaType: (op.consumes ?? doc.consumes ?? ["application/json"])[0],
          };
          continue;
        }
        if (p.in === "formData") {
          form.properties[p.name] =
            p.type === "file" ? { type: "string", format: "binary" } : p;
          if (p.required) form.required.push(p.name);
          continue;
        }
        if (!["query", "path", "header", "cookie"].includes(p.in))
          throw new Error(`Unsupported parameter location at ${path}`);
        let style = p.style;
        let explode = p.explode;
        if (doc.swagger === "2.0" && p.type === "array") {
          style =
            p.collectionFormat === "ssv"
              ? "spaceDelimited"
              : p.collectionFormat === "pipes"
                ? "pipeDelimited"
                : "form";
          explode = p.collectionFormat === "multi";
          if (p.collectionFormat === "tsv")
            throw new Error("Swagger tsv arrays are not supported");
        }
        if (
          (p.in === "query" &&
            style &&
            !["form", "spaceDelimited", "pipeDelimited", "deepObject"].includes(
              style,
            )) ||
          (p.in === "path" && style && style !== "simple") ||
          (p.in === "header" && style && style !== "simple")
        )
          throw new Error(`Unsupported ${p.in} serialization style at ${path}`);
        if (p.allowReserved)
          diagnostics.push({
            level: "warning",
            code: "allow-reserved",
            message:
              "allowReserved仍使用安全的URL编码，需自定义适配器才能精确复现",
            location: path,
          });
        parameters.push({
          name: p.name,
          in: p.in,
          required: p.in === "path" || p.required === true,
          style,
          explode,
          schema:
            p.schema ??
            (p.content
              ? Object.values(p.content)[0] &&
                (Object.values(p.content)[0] as any).schema
              : p),
        });
      }
      if (Object.keys(form.properties).length)
        body = {
          schema: form,
          required: form.required.length > 0,
          mediaType: (op.consumes ??
            doc.consumes ?? ["multipart/form-data"])[0],
        };
      if (op.requestBody) {
        const rb = resolve(doc, op.requestBody);
        const media = pickMedia(rb.content);
        if (!media) throw new Error(`Request body lacks content at ${path}`);
        body = {
          schema: media.schema,
          required: rb.required === true,
          mediaType: media.media,
        };
        if (Object.keys(rb.content).length > 1)
          diagnostics.push({
            level: "warning",
            code: "media-choice",
            message: `请求体有多种媒体类型，已选择${media.media}`,
            location: path,
          });
      }
      for (const token of path.matchAll(/\{([^}]+)\}/g))
        if (!parameters.some((p) => p.in === "path" && p.name === token[1])) {
          parameters.push({
            name: token[1],
            in: "path",
            required: true,
            schema: { type: "string" },
          });
          diagnostics.push({
            level: "warning",
            code: "inferred-path",
            message: `路径参数${token[1]}未声明，已补为必填string；请修正文档`,
            location: path,
          });
        }
      const success = Object.entries(op.responses ?? {}).filter(
        ([s]) => /^2\d\d$/.test(s) || s.toUpperCase() === "2XX",
      );
      let response: any = undefined;
      const responses: any[] = [];
      let responseType: Operation["responseType"] = "auto";
      const responseKinds = new Set<Operation["responseType"]>();
      for (const [status, r] of success) {
        const res = resolve(doc, r);
        const media = doc.swagger
          ? {
              media: (op.produces ?? doc.produces ?? ["application/json"])[0],
              schema: res.schema,
            }
          : pickMedia(res.content);
        if (status === "204" || status === "205") {
          responses.push({ type: "undefined" });
          continue;
        }
        if (media?.schema) {
          const kind = media.media.includes("json")
            ? "json"
            : media.media.startsWith("text/")
              ? "text"
              : "blob";
          responses.push(
            kind === "blob"
              ? { type: "string", format: "binary" }
              : kind === "text"
                ? { type: "string" }
                : media.schema,
          );
          responseKinds.add(kind);
          responseType = responseKinds.size === 1 ? kind : "auto";
          if (!doc.swagger && Object.keys(res.content ?? {}).length > 1)
            diagnostics.push({
              level: "warning",
              code: "response-media",
              message: `成功响应有多种媒体类型，已按${media.media}生成；请求适配器需与之匹配`,
              location: path,
            });
        } else responses.push(true);
      }
      if (!responses.length || responses.includes(true)) {
        response = true;
        diagnostics.push({
          level: "warning",
          code: "unknown-response",
          message: "成功响应缺少模型，响应类型使用unknown",
          location: method.toUpperCase() + " " + path,
        });
      } else {
        const undefinedResponses = responses.filter(
          (r) => r.type === "undefined",
        ).length;
        if (undefinedResponses === responses.length) {
          response = { type: "undefined" };
          responseType = "void";
        } else response = { oneOf: responses };
      }
      if (parameters.some((p) => p.in === "cookie"))
        diagnostics.push({
          level: "warning",
          code: "cookie",
          message:
            "Cookie参数需自定义Node请求适配器；浏览器不能直接设置Cookie头",
          location: path,
        });
      if (body && (method === "get" || method === "head"))
        diagnostics.push({
          level: "warning",
          code: "get-body",
          message: "Fetch不支持GET/HEAD请求体；此操作需要自定义适配器",
          location: path,
        });
      if (op.servers?.length || item.servers?.length)
        diagnostics.push({
          level: "warning",
          code: "operation-server",
          message:
            "操作级/路径级servers需拆分客户端；本SDK使用顶层或配置的baseUrl",
          location: path,
        });
      if (method === "head") {
        response = { type: "undefined" };
        responseType = "void";
      }
      operations.push({
        id: `${namespace}.${controller}.${name}`,
        method: method.toUpperCase(),
        path,
        controller,
        originalController: originalGroup,
        name,
        originalId,
        tags,
        summary: typeof op.summary === "string" ? op.summary : "",
        deprecated: op.deprecated === true,
        parameters,
        body,
        response,
        responseType,
        responseStatuses: success.map(([s]) => s),
        security: op.security ?? doc.security ?? [],
      });
      if (operations.length > MAX_OPERATIONS)
        throw new Error("最多支持5000个操作");
    }
  }
  if (!operations.length) throw new Error("没有找到HTTP操作");
  const server = doc.servers?.[0];
  let defaultBase = doc.swagger
    ? doc.host
      ? `${(doc.schemes ?? ["https"])[0]}://${doc.host}${doc.basePath ?? ""}`
      : (doc.basePath ?? "")
    : (server?.url ?? "");
  if (server?.variables)
    defaultBase = defaultBase.replace(
      /\{([^}]+)\}/g,
      (_: string, key: string) => server.variables[key]?.default ?? `{${key}}`,
    );
  const baseUrl = options.baseUrl ?? defaultBase;
  if (
    typeof baseUrl !== "string" ||
    /[\r\n?#]/.test(baseUrl) ||
    baseUrl.includes("{") ||
    baseUrl.startsWith("//")
  )
    throw new Error("baseUrl需为无query/hash的HTTP(S)地址或相对路径");
  if (baseUrl && !baseUrl.startsWith("/") && !/^https?:\/\//i.test(baseUrl))
    throw new Error("baseUrl仅支持HTTP(S)或相对路径");
  if (/^https?:\/\//i.test(baseUrl)) {
    const u = new URL(baseUrl);
    if (u.username || u.password)
      throw new Error("baseUrl不能嵌入用户名或密码");
  }
  return { namespace, operations, baseUrl };
}
function pickMedia(content: any): { media: string; schema: any } | undefined {
  if (!content || typeof content !== "object") return;
  const keys = Object.keys(content);
  const media =
    keys.find((k) => k === "application/json") ??
    keys.find((k) => k.includes("+json")) ??
    keys[0];
  return media ? { media, schema: content[media].schema } : undefined;
}

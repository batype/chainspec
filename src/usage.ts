import type { GeneratedProject, Operation } from "./core/model.js";
export type UsageEnvironment =
  | "universal"
  | "node"
  | "react"
  | "next-server"
  | "next-client"
  | "vite-ssr";
export function usage(
  project: GeneratedProject,
  op: Operation,
  mode: "request" | "hook" = "request",
  environment: UsageEnvironment = "universal",
) {
  const server = environment === "next-server" || environment === "vite-ssr";
  if (server || environment === "node") mode = "request";
  const reactEntry =
    mode === "hook" || environment === "react" || environment === "next-client";
  const access = `API.${project.namespace}.${op.controller}.${op.name}`;
  const params: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  for (const loc of ["path", "query", "cookie"] as const) {
    const fields = op.parameters.filter((p) => p.in === loc);
    if (fields.length)
      params[loc === "cookie" ? "cookies" : loc] = Object.fromEntries(
        fields.map((p) => {
          const type =
            p.schema && typeof p.schema === "object"
              ? (p.schema as { type?: string }).type
              : undefined;
          return [
            p.name,
            type === "number" || type === "integer"
              ? 1
              : type === "boolean"
                ? true
                : "填写参数",
          ];
        }),
      );
  }
  for (const p of op.parameters.filter((p) => p.in === "header"))
    headers[p.name] = "填写请求头";
  const options = { headers };
  const p = JSON.stringify(params, null, 2),
    o = JSON.stringify(options, null, 2);
  const body = op.body ? "body" : undefined;
  const bodyType = `Operations[${JSON.stringify(op.id)}]["body"]`;
  const client = `create${reactEntry ? "React" : ""}API({\n  baseUrl: ${JSON.stringify(project.baseUrl)},\n  cacheScope: () => 'tenant:user:authRevision',\n${environment === "next-server" ? "  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),\n" : ""}  beforeRequest: [async (ctx) => {\n    // ctx.headers.set('Authorization', ...);\n    return ctx;\n  }],\n})`;
  const intro = `${environment === "next-server" || environment === "next-client" ? "// 先在 SDK 目录执行 npm run build（纯服务端也可 build:node）。\n// Next.js 使用 dist 中的 JS 与 .d.ts，兼容默认 Turbopack。\n" : ""}${environment === "next-client" || mode === "hook" ? '"use client";\n\n' : ""}import { ${reactEntry ? "createReactAPI" : "createAPI"} } from './sdk/${environment === "next-server" || environment === "next-client" ? "dist/" : ""}${reactEntry ? "react" : environment === "node" || server ? "node" : "index"}.js';\n${op.body ? "import type { Operations } from './sdk/types.js';\n" : ""}\n${server ? "// 服务端每个入站请求创建客户端，不共享用户认证。\n" : `// SPA 中稳定创建；SSR 每个请求/渲染树创建独立实例。\nconst API = ${client};\n\n`}// params 包含 path/query/cookies，body 独立，headers 放在 options。\n// 以下值是填写提示，请按照生成的类型补全。\n`;
  if (server)
    return (
      intro +
      `export async function loadData(${op.body ? `body: ${bodyType}` : ""}) {\n  const API = ${client};\n  return ${access}.request(${p}${op.body ? ", body" : ""}, ${o});\n}\n\n// 将 await loadData(...) 的可序列化结果作为 props 传给 React 组件。\n// 客户端使用 swr.fallbackData；revalidateOnMount: false 避免首屏重复取数。\n// 完整 Next.js / Vite SSR 示例见下载包 ENVIRONMENTS.md。\n`
    );
  if (mode === "request" && reactEntry)
    return (
      intro +
      `// 在事件处理函数或业务回调中调用，不在 render 中发请求。\nexport async function submit(${op.body ? `body: ${bodyType}` : ""}) {\n  return ${access}.request(${p}${op.body ? ", body" : ""}, ${o});\n}\n`
    );
  if (mode === "request")
    return (
      intro +
      (op.body
        ? `// body 由你的表单或业务数据传入，按生成类型检查。\nasync function submit(body: ${bodyType}) {\n  const data = await ${access}.request(${p}, body, ${o});\n  return data;\n}\n`
        : `const data = await ${access}.request(${p}, ${o});\n`)
    );
  return (
    intro +
    `// 默认自动请求；refresh() 使用当前参数重新请求。\nfunction View(${op.body ? `body: ${bodyType}` : ""}) {\n  const { data, error, isLoading, trigger, refresh } =\n    ${access}.useRequest(${p}${body !== undefined ? `, ${body}` : ""}, ${JSON.stringify({ ...options, enabled: true }, null, 2)});\n  const onRefresh = () => refresh();\n  // refresh 也可在 useEffect 或自定义 Hook 的回调中调用。\n  return null;\n}\n\n// 关闭自动请求，交给事件触发；useMutation 也保持手动。\nfunction ManualAction() {\n  const { trigger, refresh, isMutating } =\n    ${access}.useRequest(${p}${body !== undefined ? ", undefined" : ""}, ${JSON.stringify({ ...options, enabled: false }, null, 2)});\n  const onSubmit = (${op.body ? `body: ${bodyType}` : ""}) => trigger(${body ?? ""});\n  // 请求体在首次 trigger(body) 时绑定，之后 refresh() 复用。\n  return null;\n}\n`
  );
}

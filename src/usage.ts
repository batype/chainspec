import type { GeneratedProject, Operation } from "./core/model.js";
import { inputExample } from "./usage-sample.js";
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
  document?: unknown,
  sdkPath = "./sdk",
  minimal = false,
) {
  const server = environment === "next-server" || environment === "vite-ssr";
  if (server || environment === "node") mode = "request";
  const reactEntry =
    mode === "hook" || environment === "react" || environment === "next-client";
  const guide = project.files["ENVIRONMENTS.md"]
    ? "ENVIRONMENTS.md"
    : "README.md";
  const buildInstruction = project.files["tsconfig.node.json"]
    ? "npm run build（纯服务端也可 build:node）"
    : "npm run build";
  const access = `API.${project.namespace}.${op.controller}.${op.name}`;
  const params: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  let complete = true;
  for (const loc of ["path", "query", "cookie"] as const) {
    const entries: [string, unknown][] = [];
    for (const field of op.parameters.filter((p) => p.in === loc)) {
      const sample = inputExample(field.schema, document);
      if (sample.ok) entries.push([field.name, sample.value]);
      else if (field.required) complete = false;
    }
    if (entries.length)
      params[loc === "cookie" ? "cookies" : loc] = Object.fromEntries(entries);
  }
  for (const field of op.parameters.filter((p) => p.in === "header")) {
    const sample = inputExample(field.schema, document);
    headers[field.name] = sample.ok ? String(sample.value ?? "") : "填写请求头";
  }
  const options = { headers };
  const p = complete ? JSON.stringify(params, null, 2) : "params",
    o = JSON.stringify(options, null, 2);
  const body = op.body ? "body" : undefined;
  const parameterType = `Operations[${JSON.stringify(op.id)}]["params"]`;
  const argumentsText = `${complete ? "" : `params: ${parameterType}`}${!complete && op.body ? ", " : ""}${op.body ? `body: Operations[${JSON.stringify(op.id)}]["body"]` : ""}`;
  const bodyType = `Operations[${JSON.stringify(op.id)}]["body"]`;
  const client = minimal
    ? `create${reactEntry ? "React" : ""}API({ baseUrl: ${JSON.stringify(project.baseUrl)}${environment === "next-server" ? ", fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' })" : ""} })`
    : `create${reactEntry ? "React" : ""}API({\n  baseUrl: ${JSON.stringify(project.baseUrl)},\n  cacheScope: () => 'tenant:user:authRevision',\n${environment === "next-server" ? "  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),\n" : ""}  beforeRequest: [async (ctx) => {\n    // ctx.headers.set('Authorization', ...);\n    return ctx;\n  }],\n})`;
  const intro = `${environment === "next-server" || environment === "next-client" ? `// 先在 SDK 目录执行 ${buildInstruction}。\n// Next.js 使用 dist 中的 JS 与 .d.ts，兼容默认 Turbopack。\n` : ""}${environment === "next-client" ? '"use client";\n\n' : ""}import { ${reactEntry ? "createReactAPI" : "createAPI"} } from ${JSON.stringify(`${sdkPath}/${environment === "next-server" || environment === "next-client" ? "dist/" : ""}${reactEntry ? "react" : environment === "node" || server ? "node" : "index"}.js`)};\n${op.body || !complete ? `import type { Operations } from ${JSON.stringify(`${sdkPath}/types.js`)};\n` : ""}\n${server ? "// 服务端每个入站请求创建客户端，不共享用户认证。\n" : `// SPA 中稳定创建；SSR 每个请求/渲染树创建独立实例。\nconst API = ${client};\n\n`}// params 包含 path/query/cookies，body 独立，headers 放在 options。\n// 示例值仅演示结构；复杂或递归参数由调用方按 Operations 类型传入。\n`;
  if (server)
    return (
      intro +
      `export async function loadData(${argumentsText}) {\n  const API = ${client};\n  return ${access}.request(${p}${op.body ? ", body" : ""}, ${o});\n}\n\n// 将 await loadData(...) 的可序列化结果作为 props 传给 React 组件。\n// 客户端使用 swr.fallbackData；revalidateOnMount: false 避免首屏重复取数。\n// 完整 Next.js / Vite SSR 示例见下载包 ${guide}。\n`
    );
  if (mode === "request" && reactEntry)
    return (
      intro +
      `// 在事件处理函数或业务回调中调用，不在 render 中发请求。\nexport async function submit(${argumentsText}) {\n  return ${access}.request(${p}${op.body ? ", body" : ""}, ${o});\n}\n`
    );
  if (mode === "request")
    return (
      intro +
      (op.body || !complete
        ? `// body 由你的表单或业务数据传入，按生成类型检查。\nasync function submit(${argumentsText}) {\n  const data = await ${access}.request(${p}${op.body ? ", body" : ""}, ${o});\n  return data;\n}\n`
        : `const data = await ${access}.request(${p}, ${o});\n`)
    );
  return (
    intro +
    `// 默认自动请求；refresh() 使用当前参数重新请求。\nfunction View(${argumentsText}) {\n  const { data, error, isLoading, trigger, refresh } =\n    ${access}.useRequest(${p}${body !== undefined ? `, ${body}` : ""}, ${JSON.stringify({ ...options, enabled: true }, null, 2)});\n  const onRefresh = () => refresh();\n  // refresh 也可在 useEffect 或自定义 Hook 的回调中调用。\n  return null;\n}\n\n// 关闭自动请求，交给事件触发；useMutation 也保持手动。\nfunction ManualAction(${complete ? "" : `params: ${parameterType}`}) {\n  const { trigger, refresh, isMutating } =\n    ${access}.useRequest(${p}${body !== undefined ? ", undefined" : ""}, ${JSON.stringify({ ...options, enabled: false }, null, 2)});\n  const onSubmit = (${op.body ? `body: ${bodyType}` : ""}) => trigger(${body ?? ""});\n  // 请求体在首次 trigger(body) 时绑定，之后 refresh() 复用。\n  return null;\n}\n`
  );
}

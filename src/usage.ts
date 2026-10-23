import type { GeneratedProject, Operation } from "./core/model";
export function usage(
  project: GeneratedProject,
  op: Operation,
  mode: "request" | "hook" = "request",
) {
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
  const intro = `import { ${mode === "hook" ? "createReactAPI" : "createAPI"} } from './sdk/${mode === "hook" ? "react" : "index"}.js';\n${op.body ? "import type { Operations } from './sdk/types.js';\n" : ""}\n// 在模块级创建；SSR 中按请求创建客户端。\nconst API = ${mode === "hook" ? "createReactAPI" : "createAPI"}({\n  baseUrl: ${JSON.stringify(project.baseUrl)},\n  cacheScope: () => 'tenant:user:authRevision',\n  beforeRequest: [async (ctx) => {\n    // ctx.headers.set('Authorization', ...);\n    return ctx;\n  }],\n});\n\n// params 包含 path/query/cookies，body 独立，headers 放在 options。\n// 以下值是填写提示，请按照生成的类型补全。\n`;
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

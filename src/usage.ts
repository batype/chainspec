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
  const body = op.body
    ? op.body.mediaType.startsWith("multipart")
      ? "{ file: selectedFile }"
      : JSON.stringify({ 填写请求体: "按生成的类型补全" }, null, 2)
    : undefined;
  const intro = `import { ${mode === "hook" ? "createReactAPI" : "createAPI"} } from './sdk/${mode === "hook" ? "react" : "index"}.js';\n\n// 在模块级创建；SSR 中按请求创建客户端。\nconst API = ${mode === "hook" ? "createReactAPI" : "createAPI"}({\n  baseUrl: ${JSON.stringify(project.baseUrl)},\n  cacheScope: () => 'tenant:user:authRevision',\n  beforeRequest: [async (ctx) => {\n    // ctx.headers.set('Authorization', ...);\n    return ctx;\n  }],\n});\n\n// params 包含 path/query/cookies，body 独立，headers 放在 options。\n// 以下值是填写提示，请按照生成的类型补全。\n`;
  if (mode === "request")
    return (
      intro +
      `const data = await ${access}.request(${p}${body !== undefined ? `, ${body}` : ""}, ${o});\n`
    );
  if (op.method === "GET" || op.method === "HEAD")
    return (
      intro +
      `function View() {\n  const { data, error, isLoading } =\n    ${access}.useRequest(${p}${body !== undefined ? `, ${body}` : ""}, ${JSON.stringify({ ...options, enabled: true }, null, 2)});\n  // 在组件或自定义 Hook 顶层调用。\n  return null;\n}\n`
    );
  return (
    intro +
    `function Action() {\n  const { trigger, isMutating } =\n    ${access}.useRequest(${p}${body !== undefined ? ", undefined" : ""}, ${o});\n  // params/options 已绑定；在提交事件中传 body，渲染不会发送请求。\n  const onSubmit = () => trigger(${body ?? ""});\n  return null;\n}\n`
  );
}

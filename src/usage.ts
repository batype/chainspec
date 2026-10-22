import type { GeneratedProject, Operation } from "./core/model";
export function usage(
  project: GeneratedProject,
  op: Operation,
  mode: "request" | "hook" = "request",
) {
  const access = `API.${project.namespace}.${op.controller}.${op.name}`;
  const input: Record<string, unknown> = {};
  for (const loc of ["path", "query", "header", "cookie"]) {
    const params = op.parameters.filter((p) => p.in === loc);
    if (params.length)
      input[loc === "header" ? "headers" : loc === "cookie" ? "cookies" : loc] =
        Object.fromEntries(
          params.map((p) => [
            p.name,
            p.schema &&
            typeof p.schema === "object" &&
            (p.schema as { type?: string }).type === "number"
              ? 1
              : "填写参数",
          ]),
        );
  }
  if (op.body)
    input.body = op.body.mediaType.startsWith("multipart")
      ? { file: "选择的 File 对象" }
      : { 填写请求体: "按生成的类型补全" };
  const arg = JSON.stringify(input, null, 2);
  const intro = `import { ${mode === "hook" ? "createReactAPI" : "createAPI"} } from './sdk/${mode === "hook" ? "react" : "index"}.js';\n\n// 在模块级创建；SSR 中按请求创建客户端。\nconst API = ${mode === "hook" ? "createReactAPI" : "createAPI"}({\n  baseUrl: ${JSON.stringify(project.baseUrl)},\n  cacheScope: () => 'tenant:user:authRevision',\n  beforeRequest: [async (ctx) => {\n    // ctx.headers.set('Authorization', ...);\n    return ctx;\n  }],\n});\n\n// 以下参数是填写提示，请按照编辑器类型补全。\n`;
  if (mode === "request")
    return (
      intro +
      `const data = await ${access}.request(${Object.keys(input).length ? arg : ""});\n`
    );
  if (op.method === "GET" || op.method === "HEAD")
    return (
      intro +
      `function View() {\n  const { data, error, isLoading } =\n    ${access}.useRequest(${arg}, { enabled: true });\n  // 在组件或自定义 Hook 顶层调用。\n  return null;\n}\n`
    );
  return (
    intro +
    `function Action() {\n  const { trigger, isMutating } =\n    ${access}.useRequest();\n  // 只在事件里触发，渲染不会发送写请求。\n  const onSubmit = () => trigger(${arg});\n  return null;\n}\n`
  );
}

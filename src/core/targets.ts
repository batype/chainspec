import type { GeneratedProject, GeneratorOptions, SDKTarget } from "./model.js";

export const SDK_TARGETS = [
  {
    value: "node",
    label: "Node.js",
    description: "仅 request；不依赖 React / SWR",
  },
  {
    value: "browser",
    label: "通用浏览器",
    description: "适合普通 Vite、Vue、Svelte 等项目；仅 request",
  },
  {
    value: "react",
    label: "React / Vite",
    description: "React 调用入口、request 与 SWR Hooks",
  },
  {
    value: "next",
    label: "Next.js",
    description: "服务端 request + 客户端 Hooks，附带构建配置",
  },
  {
    value: "vite-ssr",
    label: "Vite React SSR",
    description: "服务端预取 + React 首屏数据与 hydration",
  },
  {
    value: "all",
    label: "完整 SDK（兼容模式）",
    description: "保留所有入口和环境指南",
  },
] as const;

export function resolveSDKOptions(options: GeneratorOptions): {
  target: SDKTarget;
  hooks: boolean;
} {
  const target = options.target === undefined ? "all" : options.target;
  if (!SDK_TARGETS.some((item) => item.value === target))
    throw new Error(
      "target 必须为 node、browser、react、next、vite-ssr 或 all",
    );
  if (target === "react" && options.hooks === false)
    throw new Error(
      "React 目标需要开启 Hooks；仅需 request 时请选择 browser 或 node",
    );
  return {
    target,
    hooks:
      target === "node" || target === "browser"
        ? false
        : options.hooks !== false,
  };
}

/** Select a profile from a complete generation result. No parsing, translation or HTTP requests. */
export function selectSDKTarget(
  project: GeneratedProject,
  target: SDKTarget,
  options: { hooks?: boolean } = {},
): GeneratedProject {
  const profile = resolveSDKOptions({ target, hooks: options.hooks });
  const react = profile.hooks;
  if (react && !project.files["react.ts"])
    throw new Error("此生成结果不包含 React 入口，请开启 Hooks 后重新生成");
  const files = { ...project.files };
  if (!react)
    for (const name of ["react.ts", "hooks.ts", "tsconfig.react.json"])
      delete files[name];
  if (target === "all" && !react) {
    const metadata = JSON.parse(files["package.json"]);
    delete metadata.exports["./react"];
    delete metadata.devDependencies["@types/react"];
    delete metadata.peerDependencies;
    delete metadata.peerDependenciesMeta;
    metadata.scripts = {
      build: "tsc -p tsconfig.node.json",
      "build:node": "tsc -p tsconfig.node.json",
    };
    files["package.json"] = JSON.stringify(metadata, null, 2);
    files["README.md"] = files["README.md"].replace(
      /React SDK: npm install[^\n]*\n\n/,
      "",
    );
  }
  if (target !== "all") {
    delete files["ENVIRONMENTS.md"];
    delete files["tsconfig.node.json"];
    delete files["tsconfig.react.json"];
    if (target === "browser") delete files["node.ts"];
    if (target === "react") {
      delete files["client.ts"];
      delete files["node.ts"];
      files["index.ts"] = '"use client";\nexport * from "./react.js";\n';
    }
    const entries =
      target === "react"
        ? ["index", "react", "types"]
        : [
            "index",
            ...(target === "browser" ? [] : ["node"]),
            ...(react ? ["react"] : []),
            "types",
          ];
    files["tsconfig.json"] = JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          declaration: true,
          outDir: "./dist",
          rootDir: ".",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          skipLibCheck: true,
        },
        files: ["index.ts", ...(react ? ["react.ts"] : [])],
      },
      null,
      2,
    );
    files["package.json"] = JSON.stringify(
      {
        name: `chainspec-${target}-sdk`,
        version: "0.0.0",
        private: true,
        type: "module",
        sideEffects: false,
        exports: Object.fromEntries(
          entries.map((entry) => [
            entry === "index" ? "." : `./${entry}`,
            { types: `./dist/${entry}.d.ts`, import: `./dist/${entry}.js` },
          ]),
        ),
        scripts: { build: "tsc -p tsconfig.json" },
        devDependencies: {
          typescript: "^7.0.2",
          ...(react ? { "@types/react": "^19.3.0" } : {}),
        },
        ...(react
          ? { peerDependencies: { react: "^18.2.0 || ^19.0.0", swr: "^2.5.1" } }
          : {}),
      },
      null,
      2,
    );
    // Node is a public entry even though index.ts is the build root.
    if (files["node.ts"]) {
      const config = JSON.parse(files["tsconfig.json"]);
      config.files.push("node.ts");
      files["tsconfig.json"] = JSON.stringify(config, null, 2);
    }
    files["README.md"] = targetReadme(project, target, react);
  }
  const manifest = JSON.parse(files["manifest.json"]);
  manifest.target = target;
  manifest.hooks = react;
  files["manifest.json"] = JSON.stringify(manifest, null, 2);
  return { ...project, target, files };
}

function targetReadme(
  project: GeneratedProject,
  target: Exclude<SDKTarget, "all">,
  hooks: boolean,
): string {
  const label = SDK_TARGETS.find((item) => item.value === target)!.label;
  const op =
    project.operations.find((item) => item.method === "GET") ??
    project.operations[0];
  const access = `API.${project.namespace}[${JSON.stringify(op.controller)}][${JSON.stringify(op.name)}]`;
  const next = target === "next";
  const types = `import type { Operations } from './${next ? "dist/" : ""}types.js';\ntype Operation = Operations[${JSON.stringify(op.id)}];`;
  const argumentsText = `params: Operation['params']${op.body ? ", body: Operation['body']" : ""}`;
  const call = `params${op.body ? ", body" : ""}`;
  const nodeEntry = next
    ? "dist/node.js"
    : target === "browser"
      ? "index.js"
      : "node.js";
  const server = `import { createAPI } from './${nodeEntry}';\n${types}\n\nexport async function loadData(${argumentsText}) {\n  // 每个服务端请求创建独立客户端；认证头由应用传入。\n  const API = createAPI({ baseUrl: ${JSON.stringify(project.baseUrl)}${next ? ",\n    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' })" : ""} });\n  return ${access}.request(${call});\n}\n`;
  const client = `"use client";\nimport { useState } from 'react';\nimport { createReactAPI } from './${next ? "dist/" : ""}react.js';\n${types}\n\nexport function View({ params${op.body ? ", body" : ""}, initialData }: { ${argumentsText.replace(", body:", "; body:")}; initialData?: Operation['output'] }) {\n  // SPA 重渲染时稳定，SSR 中每棵渲染树独立创建。\n  const [API] = useState(() => createReactAPI({ baseUrl: ${JSON.stringify(project.baseUrl)} }));\n  const { data, error, trigger, refresh } = ${access}.useRequest(${call}, {\n    swr: { fallbackData: initialData, revalidateOnMount: initialData === undefined ? undefined : false },\n  });\n  // 事件回调中使用 trigger() / refresh()，不在 render 中请求。\n  return null;\n}\n`;
  return `# ${label} SDK\n\n本目录仅包含 ${label} 所需的入口、类型、运行时、构建配置及许可。\n\n## 安装与构建\n\n${hooks ? "应用需要 React、SWR 2 和 React 类型；已有依赖时不必重复安装。\n\n" : "不依赖 React 或 SWR。\n\n"}TypeScript 工程可使用应用已有的编译器：\n\n\`\`\`sh\nnpx tsc -p ./sdk/tsconfig.json\n\`\`\`\n\n也可在此目录安装所需依赖后执行 npm run build，生成 dist/*.js 和 dist/*.d.ts。Node 推荐 22+ 并提供绝对 baseUrl。持续使用 CLI --update 时将编译输出放在生成目录外（tsc -p ./sdk/tsconfig.json --outDir ./api-dist），避免触发额外文件保护。\n\n${next ? "Next.js 默认 Turbopack 请使用构建后的 dist 入口；编译保留 use client。Server Component、Route Handler、Server Action 使用 request，Client Component 才能调用 Hook。\n\n" : target === "react" || target === "browser" || target === "vite-ssr" ? "Vite 可以直接打包这些 TypeScript 源码，源码中 .js 引用会解析到对应 .ts。也可先构建后使用 dist 入口。\n\n" : "Node ESM 使用编译后的 dist/node.js 或 dist/index.js；源码中的 .js 路径在应用 TypeScript 构建时解析为对应 .ts。\n\n"}## 调用\n\n下面使用文档中的 ${op.id}，按生成类型传入真实参数。\n\n${target !== "react" ? `\`\`\`ts\n${server}\`\`\`\n\n` : ""}${hooks ? `\`\`\`tsx\n${client}\`\`\`\n\nuseRequest 默认自动请求；enabled:false 后通过 trigger() / refresh() 请求。request 也可在 React 入口上直接调用，useMutation 保持手动。Hook 只能在组件或自定义 Hook 顶层调用。\n\n` : ""}${hooks && (target === "next" || target === "vite-ssr") ? "## SSR 首屏与 hydration\n\n服务端先 await loadData(...)，将可序列化结果作为 initialData 传给组件；由 swr.fallbackData 提供首屏数据，revalidateOnMount:false 避免首屏重复请求。为每个入站请求/渲染树创建客户端和独立 SWRConfig provider 缓存。不要传递 token、Cookie、API 实例或内部缓存键到浏览器。参数变化时应更新首屏边界或只向匹配的 key 提供初始数据。\n\n" : ""}## 参数与扩展\n\n有请求体：(params, body, options)；无请求体：(params, options)。params 包含 path/query/cookies，headers 放在 options。request 返回 Promise，响应类型依据文档生成；类型不等于运行时校验。fetch 可包装原生 Fetch，request 适配器可替换传输层；beforeRequest、afterResponse、onError 支持全局和单次调用。SDK 不会自动配置业务认证或转发服务端 Cookie。\n\n更多文档取舍见 manifest.json；许可见 LICENSE.runtime.txt。\n`;
}

import type { SDKTarget } from "./core/model.js";

export const guideChapters = [
  {
    id: "overview",
    title: "项目解读",
    description: "理解输入、输出与运行方式",
  },
  {
    id: "quickstart",
    title: "安装与生成",
    description: "从一份 JSON 得到 SDK",
  },
  {
    id: "integration",
    title: "技术栈接入",
    description: "把 SDK 接进你的工程",
  },
  {
    id: "requests",
    title: "请求与 Hooks",
    description: "参数、自动请求与重新请求",
  },
  {
    id: "ssr",
    title: "服务端与 SSR",
    description: "预取、首屏数据与客户端边界",
  },
  {
    id: "configuration",
    title: "配置与扩展",
    description: "地址、认证、拦截器与命名",
  },
  { id: "faq", title: "常见问题", description: "导入、类型与生成问题" },
  { id: "development", title: "本地开发", description: "运行与理解生成器源码" },
] as const;
export type GuideChapter = (typeof guideChapters)[number]["id"];
export type GuideSnippet = { file: string; code: string };
export function guideConfig(target: SDKTarget) {
  return {
    version: 1,
    input: "./openapi.json",
    output: "./src/api",
    target,
    namespace: "main",
    groupBy: "path",
    hooks: target !== "node" && target !== "browser",
    translateNames: false,
  };
}
export function guideBuildCommand(target: SDKTarget) {
  return `npx tsc -p ./src/api/${target === "all" ? "tsconfig.react.json" : "tsconfig.json"} --outDir ./src/api-build`;
}
export function guideDependencies(target: SDKTarget) {
  return target === "node" || target === "browser"
    ? "npm install -D typescript"
    : "npm install swr\n# React 项目通常已有 React 与类型；缺少时再安装：\nnpm install -D typescript @types/react";
}
const browserClient = `import { createAPI } from './api/index.js';

export const API = createAPI({ baseUrl: 'https://api.example.com' });

export async function loadUser(id: string) {
  return API.main.users.getUser.request({ path: { id } });
}`;
const reactClient = `import { createReactAPI } from './api/react.js';

// 普通 SPA 可使用稳定实例；不要在组件每次 render 时重新创建。
export const API = createReactAPI({ baseUrl: 'https://api.example.com' });`;
const reactView = `import { API } from './apiClient.js';

export function UserView({ id }: { id: string }) {
  const { data, error, isLoading, refresh } =
    API.main.users.getUser.useRequest({ path: { id } });

  if (error) return <p>加载失败</p>;
  if (isLoading) return <p>加载中…</p>;
  return <button onClick={() => void refresh().catch(console.error)}>
    {data?.name ?? '刷新用户'}
  </button>;
}`;
const serverLoader = `import { createAPI } from './api/node.js';

export async function loadUser(id: string) {
  // 服务端每个入站请求创建独立实例；认证由应用按请求传入。
  const API = createAPI({ baseUrl: 'https://api.example.com' });
  return API.main.users.getUser.request({ path: { id } });
}`;
function hydratedView(compiled: boolean, next: boolean) {
  return `${next ? '"use client";\n\n' : ""}import { useState } from 'react';
import { SWRConfig } from 'swr';
import { createReactAPI } from './${compiled ? "api-build" : "api"}/react.js';
import type { Operations } from './${compiled ? "api-build" : "api"}/types.js';

type User = Operations['main.users.getUser']['output'];
type Props = { id: string; initialUser: User };

export function UserRoot(props: Props) {
  const [cache] = useState(() => new Map());
  return <SWRConfig value={{ provider: () => cache }}>
    <UserView {...props} />
  </SWRConfig>;
}

function UserView({ id, initialUser }: Props) {
  const [API] = useState(() => createReactAPI({
    baseUrl: 'https://api.example.com',
  }));
  const { data, error, refresh } = API.main.users.getUser.useRequest(
    { path: { id } },
    { swr: { fallbackData: initialUser, revalidateOnMount: false,
      revalidateOnFocus: false, revalidateOnReconnect: false } },
  );
  return <button onClick={() => void refresh().catch(console.error)}>
    {error ? '重试' : data?.name}
  </button>;
}`;
}
export function guideIntegration(target: SDKTarget): GuideSnippet[] {
  switch (target) {
    case "node":
      return [
        {
          file: "scripts/check-api.mjs",
          code: `import { createAPI } from '../src/api-build/node.js';

const API = createAPI({ baseUrl: 'https://api.example.com' });
const user = await API.main.users.getUser.request({ path: { id: '42' } });
console.log(user);
// 先构建 SDK，再执行 node scripts/check-api.mjs。`,
        },
      ];
    case "browser":
      return [{ file: "src/apiClient.ts", code: browserClient }];
    case "react":
      return [
        { file: "src/apiClient.ts", code: reactClient },
        { file: "src/UserView.tsx", code: reactView },
      ];
    case "next":
      return [
        { file: "src/UserRoot.tsx", code: hydratedView(true, true) },
        {
          file: "src/app/page.tsx",
          code: `import { createAPI } from '../api-build/node.js';
import { UserRoot } from '../UserRoot';

export default async function Page() {
  const id = '42';
  const API = createAPI({
    baseUrl: 'https://api.example.com',
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
  const user = await API.main.users.getUser.request({ path: { id } });
  return <UserRoot key={id} id={id} initialUser={user} />;
}`,
        },
      ];
    case "vite-ssr":
      return [
        { file: "src/loadUser.ts", code: serverLoader },
        { file: "src/UserRoot.tsx", code: hydratedView(false, false) },
      ];
    case "all":
      return [
        {
          file: "scripts/check-api.mjs",
          code: `import { createAPI } from '../src/api-build/node.js';
const API = createAPI({ baseUrl: 'https://api.example.com' });
console.log(await API.main.users.getUser.request({ path: { id: '42' } }));`,
        },
        { file: "src/UserRoot.tsx", code: hydratedView(true, true) },
      ];
  }
}
export const requestExample = `// API 来自你创建的客户端实例；字段以生成的 Operations 为准。
// path 与 query 可以同时存在；headers 放在 options。
const user = await API.main.users.getUser.request(
  { path: { id: '42' } },
  { headers: { 'X-Client': 'web' } },
);

// 有请求体时，body 固定放在第二个位置。
const created = await API.main.users.createUser.request(
  {},
  { name: 'Ada', email: 'ada@example.com' },
  { headers: { 'X-Client': 'web' } },
);`;
export const hookExample = `import { API } from './apiClient.js'; // 使用 React 入口创建的稳定实例。

export function ManualUser({ id }: { id: string }) {
  const { data, error, isMutating, refresh } =
    API.main.users.getUser.useRequest({ path: { id } }, { enabled: false });
  return <button disabled={isMutating}
    onClick={() => void refresh().catch(console.error)}>
    {error ? '重试' : data?.name ?? '加载用户'}
  </button>;
}

export function Invite() {
  const { trigger, isMutating } = API.main.users.createUser.useRequest(
    {}, undefined, { enabled: false },
  );
  return <button disabled={isMutating} onClick={() => {
    void trigger({ name: 'Ada', email: 'ada@example.com' }).catch(console.error);
  }}>邀请用户</button>;
}`;
export const middlewareExample = `import { createAPI } from './api/index.js';

// 仅示范请求层扩展；React 目标改用 createReactAPI / ./api/react.js。
export function createClient(getAccessToken: () => string) {
  return createAPI({
    baseUrl: 'https://api.example.com',
    beforeRequest: [async ctx => {
      ctx.headers.set('Authorization', \`Bearer \${getAccessToken()}\`);
      return ctx;
    }],
    afterResponse: [async response => response],
    onError: [async error => { console.error(error); }],
  });
}

// 完整替换传输层时可配置 request: async ctx => ({
//   data: ..., status: 200, headers: new Headers(...),
// })；自定义 request 优先于 fetch，需自行按 ctx.mediaType 序列化正文。`;

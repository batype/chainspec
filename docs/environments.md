# SDK 环境接入

3.2 起先选择 `target`，只生成所选技术栈需要的入口、依赖、构建配置与 README。支持 `node`、`browser`、`react`、`next`、`vite-ssr`；`all` 为兼容模式，包含本指南中的完整入口。CLI 配置和 `--target` 共用同一组选项，未指定时保持 `all`。网页工作台右上角可切换技术栈，预览和 ZIP 同步。以下 `main.users.getUser`、`User` 来自合成示例，接入时使用自己生成的操作名与类型。`@batype/chainspec` 是生成器；下面的 `sdk/node.js`、`sdk/react.js` 是生成结果的本地入口，不能写成 `@batype/chainspec/react`。生成器原有的 `@batype/chainspec/node` 是翻译适配器，含义不同。

| 场景 | 生成 SDK 入口 | 创建客户端 | 调用 |
| --- | --- | --- | --- |
| Node.js 脚本或后端 | `sdk/node.js`（`sdk/index.js` 也可） | `createAPI` | `request` |
| Vite 普通浏览器应用 | `sdk/index.js` | `createAPI` | `request` |
| Vite React SPA | `sdk/react.js` | `createReactAPI` | `request`、`useRequest`、写操作的 `useMutation` |
| Next.js Server Component、Route Handler、Server Action | `sdk/dist/node.js` / `sdk/dist/index.js` | `createAPI` | `request` |
| Next.js Client Component | `sdk/dist/react.js` | `createReactAPI` | `request`、`useRequest`、写操作的 `useMutation` |
| Vite React SSR 服务端加载器 | `sdk/node.js` / `sdk/index.js` | 每个请求创建 `createAPI` | `request`，然后传首屏数据 |
| Vite React SSR 的共享组件与客户端 hydration | `sdk/react.js` | 每棵渲染树创建并保持稳定的 `createReactAPI` | 用 `useRequest` 读取首屏数据、挂载后请求或刷新 |

## 运行与依赖

- 通用入口不导入 React 或 SWR。推荐 Node 22+，使用原生 Fetch、Headers、FormData、Blob；Node 需要绝对 `baseUrl`，例如 `https://api.example.com`，不会自动推断当前请求的 origin。
- 生成的是 TypeScript 源码，工程可用 `moduleResolution: "Bundler"`（Vite/Next.js）或 `"NodeNext"`（Node ESM）。源码中的 `.js` 路径由 TypeScript/打包器映射到对应 `.ts`。Node ESM 可用 `tsc` 编译后运行；不要求 Node 直接运行这些 `.ts` 文件。CommonJS 工程可用自己的 TypeScript 构建配置，不提供单独的预编译 CJS 文件。
- React 入口需要应用安装 React 和 SWR 2，验证版本为 React 19 / SWR 2.5。`node` / `browser` 自动不输出 React 入口；`react` 必须启用 Hooks。`next` / `vite-ssr` / `all` 可用 `hooks: false` / `--no-hooks` 只输出请求层。React 目标的 `index.ts` 导出 createReactAPI；其余目标的 `index.ts` 导出 createAPI。

## 独立构建：Next.js 默认 Turbopack / Node ESM

指定技术栈时，生成目录附带私有 `package.json` 和单一 `tsconfig.json`：使用 `npx tsc -p ./src/api/tsconfig.json` 或在 SDK 目录运行 `npm run build`。React / Next.js / Vite React SSR 启用 Hooks 时依赖 React / SWR；Node / browser 不包含这些依赖。

以下为 `target: "all"` 兼容模式的独立构建方式：附带 `tsconfig.node.json`，开启 Hooks 时另有 `tsconfig.react.json`。使用应用已安装的 TypeScript 也可直接构建：

```sh
# 在应用根目录：纯 Node / 服务端入口，不解析 React 或 SWR
npx tsc -p ./src/api/tsconfig.node.json
# React / Next.js 混合服务端与客户端入口（应用需有 React、SWR 和 @types/react）
npx tsc -p ./src/api/tsconfig.react.json
```

也可进入 SDK 目录安装所需依赖，再运行 `npm run build:node` 或 `npm run build:react`；`npm run build` 按是否开启 Hooks 选择完整构建。Node-only 用户应选择 build:node 或生成时关闭 Hooks，避免构建未使用的 React 文件。可选 peerDependencies 不会强制 Node 消费者安装 React/SWR。

Next.js 默认 Turbopack 不保证把源代码里的 `.js` 路径映射到同名 `.ts`，所以 Next.js 示例使用 `dist/node.js` / `dist/react.js`；TypeScript 编译保留 use client，`.d.ts` 保留模型与参数类型。不需要修改 Next.js 的全局模块解析规则。Vite 可直接处理原有 TypeScript 源码，也能使用 dist。Node ESM 使用 dist 运行。重新生成 SDK 后重新构建；CLI --update 会保护手工文件，建议把编译输出放在生成目录之外（使用 `--outDir ../api-dist` 并相应调整导入），或重新导入到新目录。

## Node / Next.js 服务端 / Vite SSR loader

```ts
// Next.js / Node 运行编译产物；Vite SSR loader 也可使用源码入口。
import { createAPI } from './sdk/dist/node.js';

export async function loadUser(id: string, token: string) {
  // 每个入站请求创建，避免把某个用户的认证或缓存共享给其他用户。
  const API = createAPI({
    baseUrl: 'https://api.example.com',
    headers: { Authorization: `Bearer ${token}` },
    // 可选：Next.js 的 Fetch 缓存策略。
    // 不提供时使用当前环境的 globalThis.fetch。
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
  return API.main.users.getUser.request({ path: { id } });
}
```

`fetch` 只替换 Fetch 函数，继续复用 SDK 的请求序列化、响应解码与拦截器。自定义完整 `request` 适配器时以 `request` 为准。Next.js 的 `next: { revalidate, tags }` 等可在应用提供的 Fetch 包装器中配置，SDK 不依赖 Next.js 类型。缓存策略由业务选择；用户私有响应不要放进共享公共缓存。

## React SPA / Next.js Client Component

```tsx
'use client'; // Next.js 需要；普通 Vite 会忽略该指令。
// Next.js 使用编译产物；Vite 可改为 ./sdk/react.js。
import { createReactAPI } from './sdk/dist/react.js';

// SPA 可使用稳定单例。SSR 中见下一节的每棵树实例。
const API = createReactAPI({ baseUrl: 'https://api.example.com' });
export function UserView() {
  const { data, error, isLoading, refresh } =
    API.main.users.getUser.useRequest({ path: { id: '42' } });
  if (error) return <p>加载失败</p>;
  if (isLoading) return <p>加载中</p>;
  return <button onClick={() => void refresh()}>{data?.name}</button>;
}
```

Next.js 的 **Server Component（RSC）不能调用 useRequest**。`next` / `all` 目标的 `react.ts` / `hooks.ts` 带有 `"use client"`；React / Vite 和常规 Vite SSR 目标不生成该指令。调用 Hook 的组件也应处于客户端边界。Client Component 仍可能参与服务端预渲染，所以不要在 render 中读 `window`、`localStorage` 或调用 `trigger()`。普通 SSR 渲染 React 组件时可以执行 Hook 来读取首屏数据；自动请求在客户端挂载后运行，不应依赖它完成服务端取数。

## Next.js / Vite React SSR：预取 → 首屏 → hydration

推荐对 GET 读取操作进行服务端预取。Next.js Server Component 或 Vite SSR 的服务端加载器先调用 `request()`，再将可序列化的结果传给客户端/共享组件：

```tsx
'use client';
import { useState } from 'react';
import { SWRConfig } from 'swr';
// Next.js 使用编译产物；Vite 可改为 ./sdk/react.js。
import { createReactAPI } from './sdk/dist/react.js';
import type { Operations } from './sdk/dist/types.js';

type User = Operations['main.users.getUser']['output'];
export function UserRoot({ initialUser, id }: { initialUser: User; id: string }) {
  // Next.js 和 Vite SSR 都为每棵树创建独立实例和缓存；客户端重渲染时保持稳定。
  const [API] = useState(() => createReactAPI({ baseUrl: 'https://api.example.com' }));
  const [cache] = useState(() => new Map());
  return <SWRConfig value={{ provider: () => cache }}>
    <UserDetail API={API} initialUser={initialUser} id={id} />
  </SWRConfig>;
}
function UserDetail({ API, initialUser, id }: {
  API: ReturnType<typeof createReactAPI>; initialUser: User; id: string;
}) {
  const { data, error, refresh } = API.main.users.getUser.useRequest(
    { path: { id } },
    { swr: {
      fallbackData: initialUser,
      revalidateOnMount: false, // 已预取：避免 hydration 后立即重复请求。
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    } },
  );
  return <button onClick={() => void refresh()}>{error ? '重试' : data?.name}</button>;
}
```

- 上例的 `initialUser` 必须匹配当前 `id`。切换页面参数时应更新/重建这个首屏边界，或只为匹配的 key 提供 fallbackData 并恢复该 key 的默认自动请求策略。
- 不需要预取时，直接使用默认 `useRequest`，展示相同的服务端与客户端加载态，再在挂载后自动请求。希望首屏后立即校验数据时，省略 `revalidateOnMount: false`。
- 使用 `fallbackData` 传数据，不在服务端与客户端之间传 API 实例、Headers、函数或 SDK 的内部缓存键。实例键包含环境/客户端标识，不能跨进程复制。Next.js 用 props；Vite SSR 在 HTML 中传数据时由应用负责安全序列化。
- 不要把服务端 token、Cookie 或 Fetch 包装函数作为 props 发到浏览器。SDK 不自动转发入站 Cookie、认证头；服务端按请求配置，浏览器按自己的认证方式配置。
- Vite 只有 SSR 构建机制，服务端路由、取数和 hydration 由所选 React SSR 框架/服务组织。服务端可用 `entry-server.tsx`，客户端用 `entry-client.tsx` + `hydrateRoot`。`"use client"` 在 Vite 中不会自动创建 RSC 边界；Vue/Svelte 项目只使用通用 request 入口。
- `useRequest` 的所有 HTTP 方法仍默认自动请求，这是 v3 约定。写操作需要手动时使用 `enabled: false` 或 `useMutation`；不要为 SSR 首屏展示预取有副作用的写操作。

参考：[Next.js use client](https://nextjs.org/docs/app/api-reference/directives/use-client)、[SWR 与 Next.js](https://swr.vercel.app/docs/with-nextjs)、[Vite SSR](https://vite.dev/guide/ssr.html)。

# ChainSpec · 从接口到调用

把Swagger/OpenAPI JSON变成可补全的TypeScript调用链：

```ts
API.main.users.getUser.request({path:{id:'42'}});
API.main.users.getUser.useRequest({path:{id:'42'}});
```

React + Vite本地生成器，普通Node/browser SDK与React/SWR入口分开。**不执行生成代码，不发送业务请求，不上传整份接口文档。可选自动翻译只发送缺失的分组名称。**

[在线使用](https://batype.github.io/chainspec/) · [接入指南](https://batype.github.io/chainspec/#/guide) · [需求与设计](docs/design.md) · [支持边界](docs/limits.md) · [验证记录](docs/validation.md)

![ChainSpec](https://raw.githubusercontent.com/batype/chainspec/main/docs/preview-light.png)

## 网页工作台

网页分为配置、工作台和接入指南三个独立页面：在「配置与生成」导入 OpenAPI JSON、连接受保护文档并调整生成配置；点击「生成并进入工作台」后，在「SDK 工作台」选择接口、查看类型、接入示例、源码和诊断，默认在“接入项目”按当前技术栈显示下载/CLI、依赖、构建与首次调用步骤，也可下载对应 SDK ZIP 或单个文件。返回配置不会丢失当前文档；接口或生成配置改动后需要重新生成才能导出，切换技术栈则即时同步预览与下载。

独立「接入指南」解释项目用途、npm 生成器与业务 SDK 的区别，提供安装、配置、生成和重复更新步骤。按技术栈切换接入代码，并说明 request / Hooks、SSR、地址优先级、认证、翻译与本地开发。文档入口位于导航栏，工作台的「查看接入步骤」会带入当前技术栈；切换到指南不会清除当前生成结果。

「交互体验」使用与生成 SDK 共用的 runtime 和 SWR Hook。导入业务文档后默认选择**真实请求**，内置示例默认选择**模拟演示**；打开页面或切换接口不会自动发送真实请求。点击 `request` / `trigger()` / `refresh()`，或主动勾选真实 Hook 的自动请求后，浏览器向业务服务发送 HTTP，请求路径、查询参数、body 和 headers 均按 SDK 契约处理。模拟模式继续在本地从 Schema 合成响应，不发送 HTTP。

真实模式的“请求设置”可覆盖业务 baseUrl、设置 Bearer / Basic 认证和携带目标站已有登录 Cookie。自定义认证放在 headers；导入 Swagger 文档的认证与业务 API 认证独立。调试认证只保留在工作台内存，不导出进配置或工作包。HTTP 状态、耗时、可见响应头、实际响应或错误响应体均可查看；请求可取消，默认超时 30 秒，响应预览最多 8 MiB，不跟随重定向。真实写请求会影响业务数据。

浏览器需要目标站允许 CORS、HTTPS 和相应认证；跨站 Cookie 受 SameSite 与第三方 Cookie 策略限制，不可手填 Cookie 请求头或 params.cookies。浏览器不会绕过这些限制，也不自动登录、刷新 Token 或解包业务响应。上传文件在此处仍以 JSON 占位值演示，二进制文件上传请在工程中使用生成 SDK。

页面、接口和视图使用 Hash 路由，兼容 GitHub Pages 子路径与浏览器前进/后退。文档和生成结果不自动写入持久存储；可主动下载本地工作包，刷新后恢复文档与配置，再重新生成 SDK。工作包含业务 JSON，请妥善保管，不要公开提交。连接弹窗中的账号与 Token 不进入工作包。

页面会区分演示文档、粘贴、文件与链接来源，并在 Worker 中识别文档标题、接口数和业务地址。仅修改 CLI 输出目录不会要求重新生成。配置错误可定位到对应字段；清空后可在 12 秒内撤销，内容仅保留于当前标签页内存。未保存内容刷新/离开时会尝试触发浏览器提醒，是否显示取决于浏览器；请先保存工作包，不依赖提醒保留内容。

## 一次完整流程

导入文件、粘贴JSON或从URL获取 → 填写配置表单 → 生成 → 搜索接口并预览调用、类型与诊断 → 选择技术栈 → 下载对应 SDK ZIP。输入与生成配置改动后，旧结果暂停复制/下载；仅切换技术栈或 Hooks 时无需重新解析、获取或翻译文档。输入面板可以折叠。支持亮色、暗色、系统主题和手机布局。

支持Swagger2.0、OpenAPI3.0/3.1 JSON的常见子集，本地引用、递归模型、枚举、组合类型、参数与JSON/平面表单。没有模型的响应使用unknown并提示；不是完整的OpenAPI或JSON Schema实现。远程引用、YAML和Swagger UI HTML需先转换。

## 参数约定（v2 / v3）

| 文档声明 | request / useRequest 参数 |
|---|---|
| 无请求体 | `(params, options)` |
| 有请求体 | `(params, body, options)` |

params包含`path/query/cookies`；`headers`统一放在options（标准HeadersInit），与signal、拦截器同级。是否有body取决于OpenAPI声明，而不是只看HTTP方法。没有path/query时用`{}`占位；可选body暂不传时，用`undefined`保留第二个位置。

```ts
// GET：params + options
API.main.users.getUser.request({path:{id:'42'}},{headers:{'X-Client':'web'}});
// POST：params + body + options
API.main.users.createUser.request({}, {name:'Ada',email:'ada@example.com'}, {headers:{'X-Client':'web'}});
// v3：useRequest 默认自动请求，trigger()/refresh() 可再次请求。
const bound=API.main.users.createUser.useRequest({}, {name:'Ada',email:'ada@example.com'}, {headers:{'X-Client':'web'}});
// 关闭自动请求、暂不绑定body；在事件里deferred.trigger(body)。
const deferred=API.main.users.createUser.useRequest({}, undefined, {enabled:false,headers:{'X-Client':'web'}});
```

所有 useRequest 的 enabled、swr 与 headers 同级；不使用 v1 的 `options.request.headers`。v3 的所有 HTTP 方法默认自动请求；无 body 的操作使用 `useRequest(params, options)`，有 body 使用三段入参。必填 body 延迟提供时必须设置 enabled:false，首次 trigger 必须传 body。

这是对v1生成SDK的破坏性变更。迁移步骤见[docs/migration-v2.md](docs/migration-v2.md)。

## 环境与入口

3.2 起可按技术栈生成对应的文件、依赖、构建配置和 README；网页默认 React / Vite，工作台右上角可即时切换。CLI 与 Node API 未指定 `target` 时仍采用 `all`，保留已有完整 SDK 行为。

| target | 输出内容 |
| --- | --- |
| `node` | 仅 request、Node 入口与类型；无 React / SWR 文件或依赖 |
| `browser` | 浏览器 request 入口；适合普通 Vite、Vue、Svelte |
| `react` | React / Vite 入口，request + Hooks；不附带独立 Node 入口 |
| `next` | Next.js 服务端 request 与客户端 Hooks、构建配置 |
| `vite-ssr` | Vite React SSR 服务端与客户端入口、首屏数据示例 |
| `all` | 完整入口与所有环境指南，兼容已有项目 |

`node` / `browser` 自动关闭 Hooks；`react` 必须开启 Hooks，搭配 `--no-hooks` 会提示改选 Node / browser。`next` / `vite-ssr` 可关闭 Hooks，仅生成服务端请求层。以下入口仅在对应目标中提供：

| 环境 | 生成结果中的入口 | 调用方式 |
| --- | --- | --- |
| Node / Vite SSR 取数 | `sdk/node.js` 或 `sdk/index.js` | `createAPI().…request()` |
| Next.js 服务端 | `sdk/dist/node.js`（先构建） | `request()` |
| Vite 普通浏览器应用 | `sdk/index.js` | `request()` |
| Vite React SPA | `sdk/react.js` | `createReactAPI().…request()` / `useRequest()` |
| Next.js 客户端组件 | `sdk/dist/react.js`（先构建） | `request()` / `useRequest()` |
| Vite React SSR 共享组件与 hydration | `sdk/react.js` | 首屏 fallbackData + 挂载后 useRequest / refresh |

Next.js Server Component 不能调用 Hook；Client Component 仍可能在服务端预渲染。服务端用 request 预取，再将可序列化数据交给 React 的 swr.fallbackData，按需要关闭首屏重复校验。SSR 为每个请求/渲染树创建独立客户端和缓存，不能共享用户认证。Next.js 与完整 SDK 的 React 入口保留 use client 边界，不在通用入口引入 React。React / Vite 和 Vite SSR 目标不生成该指令。

指定技术栈附带单一 `tsconfig.json`、必要依赖与针对该目标的 README；`all` 模式保留独立 Node / React 构建配置及可选 peerDependencies。Next.js 使用编译产物，兼容默认 Turbopack 的模块解析。Node-only 构建不会解析 React 入口。新增 `fetch` 配置可包装 Next.js 的 fetch 缓存策略，同时保留 SDK 序列化与拦截器。`request` 自定义适配器优先。完整步骤及 Next.js、Vite SSR 示例见 [环境接入指南](docs/environments.md)，`all` 下载包附带 `ENVIRONMENTS.md`，其他目标只附带自身的 README。

`"use client"` 用于 React Server Components 的客户端边界。3.2.1 起按目标处理：Node / browser 不带该指令；React / Vite、常规 Vite React SSR 的源码、README 和预览示例不带该指令；Next.js 仅 React / Hooks 入口与客户端组件示例保留；`all` 保留跨框架兼容行为。在普通 Vite 中该指令不会启用 RSC，也不决定 SSR 的执行位置；旧版本可以正常使用，但打包器可能报告模块指令警告。SWR 等第三方依赖自身的同类警告可能仍然出现。参见 [React 指令说明](https://react.dev/reference/rsc/use-client)。

注意：npm 的 `@batype/chainspec` 是生成器；`sdk/node.js` 与 `sdk/react.js` 是生成结果的本地入口。原有 `@batype/chainspec/node` 为生成器的翻译适配器，不是业务 SDK。

## 使用下载的SDK

将sdk文件夹放进TypeScript工程。普通入口不依赖React或SWR：

```ts
import {createAPI} from './sdk/index.js';
const API=createAPI({baseUrl:'https://api.example.com'});
const user=await API.main.users.getUser.request({path:{id:'42'}});
// user、path、query、body等按你的文档推导；这里以站内合成示例为例。
```

React入口：安装React和SWR2，客户端稳定创建，hooks在组件/自定义hook顶层调用。

```tsx
import {createReactAPI} from './sdk/react.js';
const API=createReactAPI({
  baseUrl:'https://api.example.com',
  cacheScope:()=> `${tenantId}:${userId}:${authRevision}`,
  beforeRequest:[async ctx=>{
    ctx.headers.set('Authorization',`Bearer ${getAccessToken()}`);
    return ctx;
  }],
});
function UserView(){
  const {data,error,isLoading}=API.main.users.getUser.useRequest(
    {path:{id:'42'}}, {swr:{shouldRetryOnError:false}}
  );
  return <span>{data?.name}</span>;
}
function Invite(){
  const {trigger,isMutating}=API.main.users.createUser.useRequest({}, undefined, {enabled:false,headers:{'X-Client':'web'}});
  return <button disabled={isMutating} onClick={()=>trigger({name:'Ada',email:'ada@example.com'})}>邀请</button>;
}
```

上述 tenantId/userId/authRevision/getAccessToken 由应用提供。所有 useRequest 均使用 SWR 并默认自动请求。enabled:false 关闭自动请求，仍可调用 trigger/refresh；null params 同时阻止自动与手动请求，提供真实参数后再执行。useMutation 保持只在 trigger 时请求。切换身份时更新 cacheScope 并清理应用 SWR 缓存；动态认证拦截器不会自动进入 key。

### v3 自动、手动与重新请求

| 调用 | 行为 |
|---|---|
| `useRequest(params, body?, options?)` | 默认自动请求，HTTP 方法不影响这一行为 |
| `useRequest(..., {enabled:false})` | 关闭自动请求，通过 `trigger()` / `refresh()` 请求 |
| 返回值的 `trigger(newBody?)` | 立即请求；传入新 body 时绑定新 body 并使用独立缓存键 |
| 返回值的 `refresh()` | 用当前 params 和最近一次已绑定/提交的 body 重新请求 |
| `useMutation(...)` | 保持手动触发，用于表单提交、删除等事件操作 |
| `request(...)` | 直接返回 Promise，调用时请求 |

自动请求并非每次 React 重新渲染都请求；参数或 body 对应的缓存键变化时由 SWR 处理。GET/HEAD 保留 SWR 的查询默认策略；其他方法默认关闭聚焦、重连、轮询和错误自动重试，避免额外执行写操作，可通过该 Hook 的 swr 选项显式开启。enabled:false 会关闭所有自动来源；从 false 改为 true 会恢复自动请求。

```tsx
import * as React from 'react';
import type {Operations} from './sdk/types.js';

function Search({body, revision}: {body: Operations['main.users.createUser']['body']; revision: number}) {
  // body 类型与 operationId 请以你生成的 SDK 为准。
  const {data, error, isLoading, trigger, refresh} =
    API.main.users.createUser.useRequest({}, body); // 默认自动，包括 POST

  // refresh/trigger 引用稳定，可以在 effect 或自定义 Hook 回调中调用。
  React.useEffect(() => {
    if (revision > 0) void refresh().catch(console.error);
  }, [revision, refresh]);
  return <button onClick={() => void refresh().catch(console.error)}>重新请求</button>;
}
```

`refresh()` 不接受新参数；修改组件传给 useRequest 的 params/body，或使用 trigger(newBody) 提交新 body。手动提交的 body 会复用到下一次 refresh；Hook 的 params/body/headers 或身份缓存作用域变化后，使用新的绑定值。已发起的请求仍遵循传入的 AbortSignal，不因 enabled:false 自动取消。

返回值保留 SWR 的 data/error/isLoading/isValidating/mutate，并增加 trigger、refresh、isMutating（手动请求状态）。自动、手动请求均执行请求拦截器与 SWR onSuccess/onError 回调（局部配置覆盖全局）；手动请求会更新 data/error；失败默认拒绝 Promise，需 try/catch，或 `trigger(body, {throwOnError:false})` 后读取 error。无 body 接口可用 `trigger(undefined, {throwOnError:false})`。`mutate` 保留 SWR 的缓存接口，关闭自动请求时如需网络请求请用 refresh/trigger。

**升级提示：v2 的 POST 等 useRequest 原先是手动的，v3 会默认自动请求。** 旧提交/删除调用请先替换为 useMutation，或显式添加 enabled:false，再重新生成。已有下载的 SDK 不会被网页自动修改。详见 [v3 迁移说明](docs/migration-v3.md)。

### 自定义请求和前后置处理

```ts
import {createAPI, defaultRequest, ApiError} from './sdk/index.js';
const API=createAPI({
  request:async ctx=>{
    // 在这里调用自己的请求层。默认适配器示例：
    return defaultRequest(ctx);
    // 自定义返回格式：{data, status, headers: new Headers(...)}
    // ctx.body是结构化正文，自己适配时需要按ctx.mediaType序列化。
  },
  beforeRequest:[async ctx=>{ctx.headers.set('X-Client','web');return ctx;}],
  afterResponse:[async (response,ctx)=>response],
  onError:[async (error,ctx)=>{if(error instanceof ApiError)console.warn(error.status);}],
});
```

全局链先于单次调用链；异步按顺序await；错误继续抛出。默认适配器将非2xx转为ApiError，保留AbortSignal/AbortError。不自动刷新token或重试写请求。后置解包会改变响应契约，请先核实生成类型。完整约定见下载SDK的README。

## 开发与CLI

Node22.14+：

```sh
npm ci
npm test
npm run build
npm run dev
# http://127.0.0.1:4184/chainspec/
```

CLI支持本地JSON、HTTP(S) JSON链接和配置文件。默认创建新目录；重复生成显式加`--update`，只替换未经修改、无额外文件的CLI生成目录：

```sh
npm run build:core
node bin/chainspec.mjs --in openapi.json --out ./new-sdk --target node --namespace main --strip-prefix /v1/api
# --group-by tag / --base-url URL / --no-hooks
```

### 一份 JSON 配置，网页与代码库共用

网页默认只展开“生成目标”，选择技术栈即可开始；命名与服务地址位于“高级设置”，另外提供“分组命名”“CLI 与导出”。翻译服务设置在“分组命名”内按需展开。点击旁边“查看配置”可预览、复制JSON；支持配置导入/导出，导入后回填表单。每个技术栈的 SDK ZIP 都包含选中的 `target` 和 `chainspec.config.json`；在项目中补充对应 input 文档后，可直接用 CLI 复现生成。配置格式版本`version: 1`与生成器npm版本独立。

```json
{
  "version": 1,
  "input": "https://example.com/api-json",
  "output": "./src/api",
  "namespace": "main",
  "target": "react",
  "groupBy": "tag",
  "hooks": true,
  "controllerNames": {
    "短信管理": "sms"
  }
}
```

```sh
npm install -D @batype/chainspec@^3.2.0
npx chainspec --config chainspec.config.json
# 接口更新后重新生成：
npx chainspec --config chainspec.config.json --update
# 也可直接从链接生成：
npx chainspec --in https://example.com/api-json --out ./new-sdk --target node
# 临时覆盖配置中的技术栈：
npx chainspec --config chainspec.config.json --target next --out ./next-sdk
```

不安装到项目时也可执行 `npx --yes --package=@batype/chainspec@latest chainspec --config chainspec.config.json --target node`。Node API 同样支持 `generateSDK(document, { target: "node" })`，输出内容与网页一致。技术栈配置模板见 [target.config.json](examples/target.config.json)。

加入你项目的package.json：`"sdk:generate": "chainspec --config chainspec.config.json --update"`，以后执行`npm run sdk:generate`即可。

`input`也可以是`./openapi.json`，在代码库保留对应文件即可。配置文件中的本地input/output路径相对于配置文件；显式CLI参数覆盖JSON，并相对于当前工作目录。还可配置`stripPrefix`、`baseUrl`。未知键及错误类型直接报错，配置文件不执行JavaScript。网页只读取当前导入的JSON，不根据本地路径自动读磁盘；配置中的 URL 需要在左侧“从链接导入”弹窗中点击“获取并载入”。输出目录只用于CLI。

首个Tag保留为分组依据，中文标签仍保留在说明和搜索中。2.2起网页/CLI默认自动翻译缺失的中文分组；已有映射直接复用，`translateNames:false`或`--no-translate`关闭外部翻译。调用链只生成ASCII标识符：显式`controllerNames`优先，未映射的非ASCII分组从路径推导并提示；同一Tag保持同一分组，重名使用稳定后缀。建议为中文Tag显式映射并提交配置，让名字在路径变化后仍保持稳定。2.0已有中文调用名的SDK需重新生成并修改调用；原有英文别名与v2入参约定保持不变。

`--update`通过CLI生成的文件清单和SHA256检查所有生成源码；手改源码、其他额外文件、符号链接、未由CLI管理的旧目录会拒绝更新。对于配置声明的正常 dist 构建目录，CLI 原样保留其中所有文件，不自动编译；更新后运行 npm run build 刷新产物。自定义请求与业务代码放在SDK目录外。没有`--update`仍不会覆盖已有目录。

`path`与`query`可以同时存在。例如`/users/{id}/orders?page=1`：

```ts
API.main.users.listOrders.request({
  path: { id: '42' },
  query: { page: 1 }
}, { headers: { 'X-Client': 'web' } });
// 如果文档还声明body：request({path, query}, body, options)。
// useRequest使用同样的位置；具体字段由文档推导。
```

### 2.3 文档连接与访问认证

点击 OpenAPI JSON 标题旁的“从链接导入”，在弹窗中填写 URL、认证方式和可选请求头；原有粘贴和文件导入继续可用。“保存设置”只保存连接配置，“获取并载入”会读取文档。失败提示保留在弹窗，取消或关闭会中止请求。

- **Basic**：HTTP 账号密码认证，使用 Authorization: Basic。
- **Bearer**：填写 Token，由工具添加 Bearer 前缀。
- **自定义请求头**：如 X-API-Key、X-Tenant-ID；可与 Basic/Bearer 配合。Authorization 不可重复配置。
- **Cookie 登录**：先在目标站登录，再勾选“携带已有登录 Cookie”。表单登录、验证码和 SSO 需要在目标站完成，工具不代替登录流程。是否能跨站使用 Cookie 取决于服务器 CORS、SameSite 和浏览器第三方 Cookie 策略。

网页填写的账号、密码、Token、自定义请求头值仅用于当前获取；关闭弹窗即清除，不写入 localStorage、导出配置或 SDK。配置只保存环境变量名；重新打开需要重新填写凭据。保存 URL 时不要在查询参数中放密钥。文档获取认证与生成后 SDK 的业务认证相互独立。

CLI 使用同一份配置，在配置旁放 `.env`（已有进程环境变量优先；也可 `--env-file PATH`）：

```json
{
  "version": 1,
  "input": "https://example.com/api-json",
  "output": "./src/api",
  "sourceRequest": {
    "auth": {
      "type": "basic",
      "usernameEnv": "OPENAPI_USERNAME",
      "passwordEnv": "OPENAPI_PASSWORD"
    },
    "headersEnv": { "X-Tenant-ID": "OPENAPI_TENANT" }
  }
}
```

```dotenv
OPENAPI_USERNAME=your-account
OPENAPI_PASSWORD=your-password
OPENAPI_TENANT=your-tenant
```

Bearer 配置为 `"auth": {"type":"bearer","tokenEnv":"OPENAPI_TOKEN"}`。无认证时省略 `auth`。完整模板：[连接配置](examples/source.config.json)、[环境变量模板](examples/source.env.example)。`.env` 不应提交到 Git。Node 不会自动读取浏览器 Cookie；CLI 若需要已有会话，可通过 `headersEnv.Cookie` 引用本地环境变量。

网页仍需目标站允许当前 Origin、Authorization/自定义请求头；Cookie 请求还需允许凭据且不能使用通配 Origin。无法跨域时可下载 JSON 导入或使用 CLI。本工具不会绕过访问权限。携带凭据时禁止跟随重定向，请填写最终的 JSON 地址；无认证的原有 URL 导入仍支持跳转。401/403 会提示检查认证和权限。参见 [HTTP 认证](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication)、[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)。

Node API 保持原有第二位置的 signal，新增可选第三参数：

```ts
import {fetchDocument, sourceRequestOptions} from '@batype/chainspec';
const text = await fetchDocument(config.input, signal,
  sourceRequestOptions(config.sourceRequest, process.env));
```

### 2.2 自动翻译、API Key 与名称缓存

网页支持 MyMemory（免密钥）、有道智云、百度翻译和 Google Cloud Translation。只翻译当前分组规则下缺少映射的中文名称，同一分组每次只请求一次；`controllerNames`中的手工或粘贴值优先。英文结果转为camelCase，例如`SMS Management`→`smsManagement`。已有名称不会因为切换翻译服务而改变。

配置示例：

```json
{
  "version": 1,
  "input": "./openapi.json",
  "output": "./src/api",
  "groupBy": "tag",
  "translateNames": true,
  "translation": {
    "provider": "baidu",
    "appIdEnv": "BAIDU_TRANSLATE_APP_ID",
    "apiKeyEnv": "BAIDU_TRANSLATE_SECRET_KEY",
    "proxyUrl": "http://127.0.0.1:4190/translate"
  },
  "controllerNames": {}
}
```

真实密钥放在配置旁边的`.env`中，不写到JSON、SDK或翻译缓存中：

```dotenv
BAIDU_TRANSLATE_APP_ID=你的应用ID
BAIDU_TRANSLATE_SECRET_KEY=你的密钥
```

| provider | apiKeyEnv 默认值 | appIdEnv 默认值 |
|---|---|---|
| google | GOOGLE_TRANSLATE_API_KEY | 不需要 |
| baidu | BAIDU_TRANSLATE_SECRET_KEY | BAIDU_TRANSLATE_APP_ID |
| youdao | YOUDAO_TRANSLATE_SECRET_KEY | YOUDAO_TRANSLATE_APP_KEY |
| mymemory | 不需要 | 不需要 |

CLI自动读取配置旁边的`.env`，系统已有环境变量优先。也可用`--env-file PATH`指定文件。可以复制[配置示例](examples/translation.config.json)和[环境变量模板](examples/translation.env.example)。

```sh
npx chainspec --config chainspec.config.json --update
```

成功翻译会写回配置文件的`controllerNames`，SDK中也有`controller-names.json`。这些JSON是可提交到代码库的名称缓存，下一次生成优先复用，无需再次调用翻译API；`--update`也会读取原SDK的缓存。CLI不覆盖生成期间被其他程序修改的配置。失败项只回退路径命名并诊断，不写入成功缓存，下次可以重试；不会改用其他服务发送名称。CLI未成功写回时会提示，已生成SDK中的缓存仍保留。

网页默认在当前浏览器缓存名称，也把映射写入下载配置与ZIP中的`controller-names.json`。支持粘贴JSON、完整配置中的controllerNames，或每行`原分组=英文名`；支持复制映射和清除浏览器缓存。浏览器无法直接改写代码库文件，需将导出的配置保存回工程。

#### 网页使用带密钥的服务

GitHub Pages是静态网页。网页通过你自己的翻译代理调用有道、百度或Google，密钥保留在本机。包内附带本地代理：

```sh
# 配置和.env准备好后运行：
npx chainspec translate-server --config chainspec.config.json --origin https://batype.github.io
```

将网页服务选择与JSON配置保持一致，代理地址填写`http://127.0.0.1:4190/translate`。开发预览时把`--origin`改成当前页面的origin（如`http://127.0.0.1:4185`）。代理只监听127.0.0.1，只允许指定origin，只接收分组名称和服务名，不接收浏览器传入的密钥。浏览器可能要求本地网络访问许可；也可在自己的后端部署HTTPS代理，按同样协议实现：`POST {text,provider}`→`{translatedText}`。CLI直接访问官方服务，`proxyUrl`仅用于网页。

Node适配器使用[百度MD5签名](https://fanyi-api.baidu.com/doc_bd/21)、[有道v3 SHA256签名](https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html)、[Google Basic v2 API Key](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)。MyMemory匿名额度目前为[每日5000字符](https://mymemory.translated.net/doc/usagelimits.php)，单次500字节；其他服务按用户账户权限和配额计费。本工具自动翻译每次最多100个分组、5000字符，每个名称最多500字节；超出部分会提示并回退路径命名，已有缓存继续生效。

同步`generateSDK`始终离线。异步API可配置自己的翻译方法；Node官方适配器也可嵌入你的后端：

```ts
import {generateSDKAsync} from '@batype/chainspec';
import {createNodeTranslator} from '@batype/chainspec/node';
const translation = {provider:'google',apiKeyEnv:'GOOGLE_TRANSLATE_API_KEY'} as const;
const project = await generateSDKAsync(jsonText, {groupBy:'tag',translation}, {
  translate:createNodeTranslator(translation)
});
// 保存project.controllerNames供下次复用。
```

Node生成器API：

```ts
import {generateSDK, parseConfig, fetchDocument} from '@batype/chainspec';
const project=generateSDK(jsonText,{namespace:'main',groupBy:'path',hooks:true});
// project.files: 文件名→内容；operations与diagnostics供自定义工具展示
// const config = parseConfig(configJSON);
// const remote = generateSDK(await fetchDocument(config.input), config);
```

已正式发布到[npm：@batype/chainspec](https://www.npmjs.com/package/@batype/chainspec)，也可下载[GitHub Release tarball](https://github.com/batype/chainspec/releases)。

```sh
npm install -D @batype/chainspec
npx --yes --package=@batype/chainspec chainspec --in openapi.json --out ./new-sdk --namespace main
```

生成器npm入口不需要React、SWR或ZIP依赖。生成SDK自身的React入口才需要SWR。

## 数据与安全边界

只有点击获取链接或执行CLI时才GET指定的JSON；浏览器不携带Cookie/认证、不经过代理，目标站需允许CORS，HTTPS页面不能获取HTTP资源。生产CSP仅为URL导入允许HTTP(S)连接；Worker仍只解析文档，不获取外部引用。URL导入有20秒超时及8MiB流式限制，可取消。仅主题和英文分组名称缓存持久化，无云历史或遥测。输入最大8MiB、5000操作/模型。清空后移除当前输入和结果。不要未经检查就公开包含业务模型、地址和枚举的生成SDK。仓库、截图和测试使用合成API；用户提供的文档不进入公开源码。

类型不验证服务端数据；不猜鉴权凭据；不保证复杂序列化和所有Schema约束。int64依然是JS number，需要精度时由服务器返回string。参阅[限制](docs/limits.md)。

MIT © 2026 batype。生成SDK中的运行时代码附LICENSE.runtime.txt；第三方网页依赖见[THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt)。

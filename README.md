# ChainSpec · 从接口到调用

把Swagger/OpenAPI JSON变成可补全的TypeScript调用链：

```ts
API.main.users.getUser.request({path:{id:'42'}});
API.main.users.getUser.useRequest({path:{id:'42'}});
```

React + Vite本地生成器，普通Node/browser SDK与React/SWR入口分开。**不执行生成代码，不发送业务请求，不上传输入文档。**

[在线使用](https://batype.github.io/chainspec/) · [需求与设计](docs/design.md) · [支持边界](docs/limits.md) · [验证记录](docs/validation.md)

![ChainSpec](https://raw.githubusercontent.com/batype/chainspec/main/docs/preview-light.png)

## 一次完整流程

导入或粘贴JSON → 配置命名空间/分组/服务地址 → 生成 → 搜索接口并预览调用、类型与诊断 → 下载完整SDK ZIP。输入与配置改动后，旧结果暂停复制/下载。输入面板可以折叠。支持亮色、暗色、系统主题和手机布局。

支持Swagger2.0、OpenAPI3.0/3.1 JSON的常见子集，本地引用、递归模型、枚举、组合类型、参数与JSON/平面表单。没有模型的响应使用unknown并提示；不是完整的OpenAPI或JSON Schema实现。远程引用、YAML和Swagger UI HTML需先转换。

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
  const {trigger,isMutating}=API.main.users.createUser.useRequest();
  return <button disabled={isMutating} onClick={()=>trigger({body:{name:'Ada',email:'ada@example.com'}})}>邀请</button>;
}
```

上述tenantId/userId/authRevision/getAccessToken由你的应用提供。GET/HEAD使用useSWR；其他方法的useRequest（也可用useMutation）返回trigger，挂载时不发送写操作。null输入或enabled:false暂停查询。切换身份时更新cacheScope并清理应用SWR缓存；动态认证拦截器不会自动进入key。

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

CLI从本地JSON生成一个**新目录**，不会覆盖已有目录：

```sh
npm run build:core
node bin/chainspec.mjs --in openapi.json --out ./new-sdk --namespace main --strip-prefix /v1/api
# --group-by tag / --base-url URL / --no-hooks
```

Node生成器API：

```ts
import {generateSDK} from '@batype/chainspec';
const project=generateSDK(jsonText,{namespace:'main',groupBy:'path',hooks:true});
// project.files: 文件名→内容；operations与diagnostics供自定义工具展示
```

已正式发布到[npm：@batype/chainspec](https://www.npmjs.com/package/@batype/chainspec)，也可下载[GitHub Release tarball](https://github.com/batype/chainspec/releases)。

```sh
npm install -D @batype/chainspec
npx --yes --package=@batype/chainspec chainspec --in openapi.json --out ./new-sdk --namespace main
```

生成器npm入口不需要React、SWR或ZIP依赖。生成SDK自身的React入口才需要SWR。

## 数据与安全边界

生产CSP `connect-src 'none'`；Worker只解析本地文档。仅主题持久化，无云历史或遥测。输入最大8MiB、5000操作/模型。清空后移除当前输入和结果。不要未经检查就公开包含业务模型、地址和枚举的生成SDK。仓库、截图和测试使用合成API；用户提供的文档不进入公开源码。

类型不验证服务端数据；不猜鉴权凭据；不保证复杂序列化和所有Schema约束。int64依然是JS number，需要精度时由服务器返回string。参阅[限制](docs/limits.md)。

MIT © 2026 batype。生成SDK中的运行时代码附LICENSE.runtime.txt；第三方网页依赖见[THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt)。

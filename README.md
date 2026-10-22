# ChainSpec · 从接口到调用

把Swagger/OpenAPI JSON变成可补全的TypeScript调用链：

```ts
API.main.users.getUser.request({path:{id:'42'}});
API.main.users.getUser.useRequest({path:{id:'42'}});
```

React + Vite本地生成器，普通Node/browser SDK与React/SWR入口分开。**不执行生成代码，不发送业务请求，不上传整份接口文档。可选自动翻译只发送缺失的分组名称。**

[在线使用](https://batype.github.io/chainspec/) · [需求与设计](docs/design.md) · [支持边界](docs/limits.md) · [验证记录](docs/validation.md)

![ChainSpec](https://raw.githubusercontent.com/batype/chainspec/main/docs/preview-light.png)

## 一次完整流程

导入文件、粘贴JSON或从URL获取 → 填写配置表单 → 生成 → 搜索接口并预览调用、类型与诊断 → 下载完整SDK ZIP。输入与配置改动后，旧结果暂停复制/下载。输入面板可以折叠。支持亮色、暗色、系统主题和手机布局。

支持Swagger2.0、OpenAPI3.0/3.1 JSON的常见子集，本地引用、递归模型、枚举、组合类型、参数与JSON/平面表单。没有模型的响应使用unknown并提示；不是完整的OpenAPI或JSON Schema实现。远程引用、YAML和Swagger UI HTML需先转换。

## 2.0 调用约定

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
// React 写hook：绑定body后，在事件里trigger()；也可trigger(newBody)覆盖。
const bound=API.main.users.createUser.useRequest({}, {name:'Ada',email:'ada@example.com'}, {headers:{'X-Client':'web'}});
// 或者暂不绑定body，在事件里deferred.trigger(body)。
const deferred=API.main.users.createUser.useRequest({}, undefined, {headers:{'X-Client':'web'}});
```

GET/HEAD hook options中的enabled、swr与headers同级；不再使用v1的`options.request.headers`。写hook不自动发送请求，必填body未绑定时，trigger也必须提供body。无body的写操作使用`useRequest(params, options)`及`trigger()`。

这是对v1生成SDK的破坏性变更。迁移步骤见[docs/migration-v2.md](docs/migration-v2.md)。

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
  const {trigger,isMutating}=API.main.users.createUser.useRequest({}, undefined, {headers:{'X-Client':'web'}});
  return <button disabled={isMutating} onClick={()=>trigger({name:'Ada',email:'ada@example.com'})}>邀请</button>;
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

CLI支持本地JSON、HTTP(S) JSON链接和配置文件。默认创建新目录；重复生成显式加`--update`，只替换未经修改、无额外文件的CLI生成目录：

```sh
npm run build:core
node bin/chainspec.mjs --in openapi.json --out ./new-sdk --namespace main --strip-prefix /v1/api
# --group-by tag / --base-url URL / --no-hooks
```

### 一份 JSON 配置，网页与代码库共用

网页的配置区使用表单填写，点击旁边“查看配置”可预览、复制JSON；支持配置导入/导出，导入后回填表单。完整SDK ZIP也包含`chainspec.config.json`。配置格式版本`version: 1`与生成器npm版本独立。

```json
{
  "version": 1,
  "input": "https://example.com/api-json",
  "output": "./src/api",
  "namespace": "main",
  "groupBy": "tag",
  "hooks": true,
  "controllerNames": {
    "短信管理": "sms"
  }
}
```

```sh
npm install -D @batype/chainspec@^2.2.0
npx chainspec --config chainspec.config.json
# 接口更新后重新生成：
npx chainspec --config chainspec.config.json --update
# 也可直接从链接生成：
npx chainspec --in https://example.com/api-json --out ./new-sdk
```

加入你项目的package.json：`"sdk:generate": "chainspec --config chainspec.config.json --update"`，以后执行`npm run sdk:generate`即可。

`input`也可以是`./openapi.json`，在代码库保留对应文件即可。配置文件中的本地input/output路径相对于配置文件；显式CLI参数覆盖JSON，并相对于当前工作目录。还可配置`stripPrefix`、`baseUrl`。未知键及错误类型直接报错，配置文件不执行JavaScript。网页只读取当前导入的JSON，不根据本地路径自动读磁盘；配置中的URL需要点击“获取JSON”。输出目录只用于CLI。

首个Tag保留为分组依据，中文标签仍保留在说明和搜索中。2.2起网页/CLI默认自动翻译缺失的中文分组；已有映射直接复用，`translateNames:false`或`--no-translate`关闭外部翻译。调用链只生成ASCII标识符：显式`controllerNames`优先，未映射的非ASCII分组从路径推导并提示；同一Tag保持同一分组，重名使用稳定后缀。建议为中文Tag显式映射并提交配置，让名字在路径变化后仍保持稳定。2.0已有中文调用名的SDK需重新生成并修改调用；原有英文别名与v2入参约定保持不变。

`--update`通过CLI生成的文件清单和SHA256检查所有生成文件；手改文件、额外文件、符号链接、未由CLI管理的旧目录会拒绝更新。自定义请求与业务代码放在SDK目录外。没有`--update`仍不会覆盖已有目录。

`path`与`query`可以同时存在。例如`/users/{id}/orders?page=1`：

```ts
API.main.users.listOrders.request({
  path: { id: '42' },
  query: { page: 1 }
}, { headers: { 'X-Client': 'web' } });
// 如果文档还声明body：request({path, query}, body, options)。
// useRequest使用同样的位置；具体字段由文档推导。
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

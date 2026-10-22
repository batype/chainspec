# ChainSpec：需求与设计

为使用Swagger/OpenAPI维护接口的TypeScript开发者，将接口文档转为可补全的调用链：`API.main.controller.method.request()`，以及可选的SWR入口。Web前端统一React + Vite；核心生成逻辑独立，运行在Worker，也供CLI/Node调用。

已有工具：[openapi-typescript](https://openapi-ts.dev/introduction)擅长类型生成，[aspida](https://github.com/aspida/aspida)提供类型友好的HTTP包装。本项目聚焦中文浏览器工作台、指定的控制器调用链、下载可阅读源码和SWR读写分流；不声称替代完整OpenAPI编译器，也无使用频率数据。

## 调用约定

- `API`是创建的客户端实例；`main`是命名空间，可配置为`mian`、`admin`等。每份文档生成一个命名空间。组合多份文档时由业务组合不同实例，不共享认证或缓存。
- 控制器默认按路径分组，常见`/v1/api`等前缀自动移除。移除只影响命名，不改实际请求路径。支持首个tag分组及显式别名映射；中文tag可以作为JS属性。
- 方法从operationId转为camelCase，无operationId时从方法/路径生成。分组内重名追加HTTP方法和路径哈希，并记录诊断。建议后端提供稳定、唯一的operationId，否则新增冲突可能使名字变化。
- `.request(input,options)`返回Promise，input明确区分path/query/headers/cookies/body。没有必填参数时可省略input；参数必填性由类型与基础运行时检查约束。
- 不把Swagger UI页面URL当作接口基地址。输入必须是JSON正文；基地址来自servers/host或用户配置。相对servers需要与业务部署环境核对。

## 类型的可信边界

支持本地引用、递归命名模型、常见原始类型/数组/对象、required、enum、nullable、oneOf/anyOf/allOf。分别生成Schemas、InputSchemas（去readOnly）、OutputSchemas（去writeOnly）以及Operations入参与返回类型。日期保持字符串；binary是Blob；int64仍是JS number，精度敏感接口应由服务端使用字符串。

缺失响应模型和不存在的模型引用使用unknown并诊断。缺失的路径参数声明补为必填string并诊断。文档缺漏不冒充完整类型。TypeScript不验证服务端数据，数值范围、正则、oneOf互斥性等仍需业务校验。没有引入any作为模型兜底。

首版支持Swagger2.0和OpenAPI3.0/3.1 JSON的常见子集；不支持YAML、3.2、远程引用获取和完整JSON Schema语义。外部引用需先bundle。复杂序列化、流式响应等见limits.md。

## SWR行为

[官方参数文档](https://swr.vercel.app/docs/arguments)强调缓存key需要包含影响结果的参数，[Mutation文档](https://swr.vercel.app/docs/mutation)提供手动触发写操作。

- GET/HEAD：`.useRequest(input,{enabled,request,swr})`，底层useSWR；null或enabled:false暂停。
- POST/PUT/PATCH/DELETE等：`.useRequest({request,swr})`与`.useMutation(...)`等价，底层useSWRMutation；只有trigger(input)才发送，不在挂载或焦点变化时自动写入。
- key包含实例ID、基地址、operation、输入、显式请求头和cacheScope。改变同一客户端的身份时必须改变cacheScope（例如tenant:user:authRevision）；别把token放在scope。登出同时清理应用SWR Provider缓存。拦截器动态加的凭据不能自动推断到key中。
- 客户端在模块级或Provider中稳定创建；SSR按请求隔离。hooks只能在组件/自定义hook顶层无条件调用。写操作后是否刷新哪些查询，由业务调用mutate决定，不猜测关联。

## 请求扩展

默认Fetch；可注入完整RequestAdapter替换网络层。统一的TransportResponse为{data,status,headers:Headers}，不直接接受任意Axios对象。前置→请求→成功状态检查→后置，错误走onError后继续抛出。全局链先于单次调用链，各链顺序await。可传AbortSignal。默认request不重试、不自动刷新token；避免写请求被重复发送。SWR的重试由用户配置。

后置处理可以变更响应，但不能在类型仍指向服务端包裹结构时悄悄取data.data。适配器必须与声明的响应形状一致；若需全局解包，请先改契约或另写有类型的包装层。

## Web产品范围

导入/粘贴→配置→本地生成→查看接口/调用/类型/诊断→下载ZIP。源码与配置改变后标记旧结果，复制下载暂停，防止导出旧SDK。输入可折叠，结果区有独立滚动。主题可保存，业务文档和结果不持久化。生产CSP禁止网络连接，生成器不执行生成代码，不发送业务请求。

用户提供的真实JSON仅在本地验证并生成私有交付物；公开项目、示例与截图使用合成数据。

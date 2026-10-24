# 支持范围

- JSON最大8MiB，最多5000操作/模型，schema递归/复杂度有界。错误不回显原始JSON全文。
- Swagger2.0、OpenAPI3.0/3.1常见结构。支持本地命名schema引用与递归；外部引用不联网，直接拒绝。非schema循环引用拒绝。
- 本地响应/请求体/参数Reference解析；content有多种时选JSON、+json或首个，提示选择；多种成功响应取类型union，缺失schema则unknown。无内容204/205及HEAD为undefined。
- 参数支持path simple、header标量/数组、query form、spaceDelimited、pipeDelimited、平面deepObject；嵌套query、header对象、matrix/label、allowReserved精确复现暂不支持。未知style拒绝；allowReserved仍编码并提示。显式cookie参数需要自定义Node适配器；浏览器Fetch不允许设置Cookie。
- 正文支持JSON、平面multipart（Blob/File）和URL编码表单；嵌套表单、自定义encoding和复杂媒体语义需自定义适配器。GET/HEAD正文默认Fetch报错，需自定义适配器。
- 使用顶层servers/host或用户覆盖的baseUrl。操作/路径级servers只诊断；多个server需按环境创建实例。变量使用文档default，未解析变量会报错。
- Schema支持基础类型、枚举、const、nullable、对象/数组、oneOf/anyOf/allOf及方向性readOnly/writeOnly；只提供编译期类型。未覆盖的条件schema、patternProperties等会提示；discriminator不生成运行时验证器。$ref的3.1兄弟约束、复杂元组、XML、callbacks、webhooks、stream、重试、token刷新和HTTP行为完全等价不在首版保证内。
- 对JSON数字的解析使用JS标准JSON.parse。int64参数/响应使用number；敏感精度由服务端建模为string。不要把类型生成当成无损JSON工具。
- SDK运行依赖现代Fetch/Headers/Blob/FormData/URLSearchParams；Node22+或现代浏览器。React入口额外需要React及SWR；node / browser 及通用服务端入口不需要。react 目标的 index 直接导出 React 客户端。SWR跨身份隔离还需要调用方正确维护cacheScope和清理缓存。
- 文件导入本地UTF-8，显式支持HTTP(S) JSON链接（20秒超时、8MiB流式限制）。浏览器需目标站允许CORS，连接设置支持Basic/Bearer/自定义头及已有登录Cookie；受混合内容、SameSite与浏览器第三方Cookie策略限制。凭据仅用于本次读取，不保存到SDK；CLI可通过环境变量引用。无法跨域可用Node CLI获取或下载文件导入。不自动解析Swagger UI HTML。没有登录、遥测、云历史或服务端代理。只持久化主题和名称映射缓存；清空、刷新、关闭会丢失未下载结果。

- 可选自动翻译只发送分组名称；免费服务有额度，付费服务需要用户账户开通与API凭据。每次最多100组、5000字符，单组500字节。无效译文、鉴权、限流和网络错误均诊断并保留原路径回退；失败项不缓存。切换服务不会自动覆盖已有映射，可粘贴新名称覆盖。
- 静态网页的有道/百度/Google接入需本地或自建代理；真实密钥存放本地环境变量，不进入公开配置和SDK。不同浏览器对HTTPS页面访问loopback可能要求本地网络权限或额外限制；可改用自己的HTTPS代理或直接使用CLI。
- v3 useRequest 对所有 HTTP 方法默认自动请求；手动操作需要 enabled:false 或 useMutation。非 GET/HEAD 默认关闭聚焦、重连、轮询和错误自动重试。refresh 使用当前参数，trigger(newBody) 改用新 body 缓存；同一 key 的显式多次 trigger 不自动合并，写操作幂等由业务保证。React StrictMode/组件重新挂载仍遵循 React/SWR 生命周期，需精确控制的写操作使用手动模式。

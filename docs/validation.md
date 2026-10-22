# 验证记录 · 2026-10-22

所有公开测试、截图和仓库示例使用合成API。用户业务JSON及其生成物仅留在项目外的本地交付目录。

## 自动测试

`npm test`九组通过：

1. 实际生成全部文件，并严格编译普通与React入口；名称冲突、缺失引用、递归模型、输入输出方向类型和不带hooks模式。
2. 正向类型使用及`@ts-expect-error`反向断言：缺少必填path、错误path类型、缺少必填body字段、读取writeOnly响应字段均被拒绝。
3. 自定义请求适配器、路径保留字符编码、查询数组/平面deepObject、全局/单次异步拦截器顺序。
4. 默认Fetch的JSON/multipart正文、非2xx ApiError、AbortError保留及错误回调；Fetch由stub替换，没有外部网络。
5. 缺少参数时不进入适配器；缓存key隔离客户端、参数和身份scope。
6. Swagger2.0、命名空间别名、中文tag分组、缺失path参数诊断。
7. 无效JSON、未知版本、危险命名空间、外部引用、未支持参数style明确拒绝。
8. 在React测试组件中真实执行SWR：禁用查询不请求、启用后读取data、写hook挂载不发送、trigger后才发送。
9. CLI新目录生成及已有输出保护。

React测试使用react-test-renderer，运行时会输出其官方弃用提示；它仅是开发依赖，不进入生成器npm包或网页产物。前端生产构建无控制台警告/错误。

`npm run build`包含TypeScript类型检查及Vite生产构建，通过。

## 真实文档本地验证

用户提供的OpenAPI3.0 JSON生成489个操作、422个模型，所有TS源文件严格编译通过。另以真实方法名编写普通login请求、login mutation hook、在线用户查询、动态认证与scope示例，并编译通过。没有向业务服务器发送请求。未声明成功响应模型、缺失引用、路径参数缺漏、重名和其他取舍均在私有manifest中列出；通过编译不表示这些接口契约已补齐。

## 浏览器验收

Vite生产预览，桌面1280×960、手机390×844，亮/暗主题无页面横向溢出。检查调用链、request/useRequest示例、namespace main→mian、更改后禁止复制/下载、折叠输入、错误文档清除旧预览、清空并载入示例恢复。

点击复制后核对真实剪贴板中的调用链。手机版点击下载完整SDK，实际下载ZIP；解压9个文件（含运行时MIT许可），全部TS严格编译通过。生产CSP禁止网络连接，Worker正常，控制台无warning/error。

浏览器文件选择器导入未单独实测；已验证粘贴/默认示例流程。尚未覆盖所有浏览器或所有OpenAPI/JSON Schema特性，支持边界见limits.md。

## npm打包

`npm pack`检查15个文件，不包含业务文档、测试私有生成物或本机配置。在项目外以offline/ignore-scripts安装tarball，调用generateSDK成功、安装后CLI版本为1.0.0。生成器包无运行时第三方依赖。正式注册表验证见下文。

## 公开发布验证

GitHub Actions排队后在提交7e89e3fdc805cfc54ddbe650e495f7ff5bc03c5a上测试及Pages部署成功。公开站点实际加载并生成6个合成操作，切换SWR调用示例及折叠输入正常，控制台无warning/error。

npm发布授权完成后返回`+ @batype/chainspec@1.0.0`。等待后台处理后，官方公开元数据返回1.0.0，SHA-1为`7c07588d84cb79e70da01ee578891b51b6b26be3`，与发布包一致。

在项目外使用独立缓存、`--userconfig=/dev/null`、官方registry、ignore-scripts全新安装注册表版本；调用generateSDK检查类型、分组和SWR文件通过，运行安装后的CLI生成不带hooks的SDK成功，版本1.0.0。无运行时第三方依赖。此验证不是本地tarball替代安装。

## 2.0 参数签名变更验证

本次只调整生成类型、runtime/Hook模板、调用预览和迁移说明；文档解析、schema映射、网络适配器协议、视觉样式与存储方式沿用原实现。

- `npm test`：12组通过，包含原有编码/错误/适配器/缓存/CLI回归和三组新增验证。
- 有body操作使用params/body/options三段，无body使用params/options；body内部即使有headers字段也不被当成options。必填header可以由options.headers（含Headers实例）或异步beforeRequest提供，缺失时拒绝进入适配器。
- 反向类型检查覆盖旧body信封、错误body、非对象空params、params中的headers、旧options.request.headers、缺少必填body和未绑定body时的空trigger。可选body与undefined占位正向通过。
- SWR真实组件验证：GET headers在第二参数；写hook渲染不请求，绑定body的trigger()、trigger(newBody)、延迟绑定trigger(body)、无body写操作trigger()都按对应params/options发送。
- 缓存key同时区分params、body、options.headers；原有实例和身份隔离测试继续通过。
- `npm run build`通过。生产预览的POST调用和Hook示例按新位置显示，headers在options；实际下载ZIP的manifest为2.0.0，解压后全部源码严格编译通过，控制台无警告/错误。
- 用户的489操作、422模型重新生成到独立v2目录，源码和更新后的integration.example.tsx严格编译通过。完整客户端在本地stub执行真实login与getOnlineUsers名称，核对独立body、分页及headers，无业务网络请求。v1目录保持原样。

## 2.1 JSON配置、英文分组和URL导入

- 16组测试通过：新增同一中文Tag多路径单组、ASCII命名/显式别名/稳定重名、配置类型与未知键校验、配置相对路径及flag优先级、CLI更新与手工修改/额外文件/符号链接保护、URL成功/HTML/HTTP错误/长度与流式限额/取消。原有12组v2类型、运行时、SWR与CLI回归继续通过。
- `npm run build`通过。生产预览实际从用户指定来源读取489个操作，首Tag映射为英文，request/useRequest预览使用Operations body类型。实际SDK ZIP包含version 2.1.0及共用JSON配置，独立生成的489操作/422模型SDK严格TypeScript编译通过；未发送业务接口请求。
- 浏览器验证无效JSON配置会禁用生成与SDK下载，修复后恢复；配置导出再导入成功。合成接口同时含path/query的预览通过。公开截图使用合成Messaging API。
- `npm pack`包含19个生成器文件，未包含用户业务文档或SDK。项目外offline/ignore-scripts安装tarball，CLI版本及parseConfig/fetchDocument/generateSDK导出通过。

## 配置表单与JSON预览

- 默认使用命名空间/分组/路径前缀/服务地址/SWR表单，映射支持逐行添加与删除；CLI输入输出路径保留在折叠选项中。查看配置使用原生dialog，支持Esc关闭并恢复按钮焦点。
- 浏览器验证表单值与JSON预览、导出文件及SDK生成一致；导入配置回填表单，省略hooks时默认开启且React入口可见。非法命名空间保留原输入并禁用生成。复制JSON、映射添加/删除、弹窗关闭均通过，控制台无错误。
- `npm test` 16组通过，`npm run build`与`git diff --check`通过。首轮本地HTTP测试因未开放监听权限失败，授予本地网络权限后完整复测通过。核心生成器、CLI与npm版本保持2.1.0。

## 2.2 多服务翻译与可复用缓存

- 22组测试通过，原有16组全部保留。新增：缺失首Tag提取/手工映射优先/失败不缓存；重名缓存稳定；取消与离线模式；翻译配置拒绝明文密钥/缺失凭据不外发；百度MD5、有道v3 SHA256（含长文本截断）、Google v2请求与错误脱敏；loopback代理Origin与provider限制；CLI读取.env并写回配置、移除密钥后仍可缓存重生成。
- 官方协议按当前文档实现。免费MyMemory使用合成分组名称完成真实HTTP和浏览器调用；有道/百度/Google使用模拟凭据与响应验证协议，未使用真实付费账户或业务名称进行付费服务实测。
- 浏览器实际验证默认三个中文分组生成英文缓存；粘贴映射覆盖生效。本地代理端到端使用stub，连续两次生成只收到一次未缓存分组请求；已有分组没有传出。SDK ZIP包含共用配置和controller-names.json，不包含真实密钥。
- 前端与Worker继续React+Vite，共用独立核心；SDK请求运行时及SWR参数约定未变。同步generateSDK离线；新增异步生成和Node适配器。
- 最终生产构建通过。项目外安装26文件的tarball，根入口与@batype/chainspec/node可导入，TypeScript声明严格检查通过；CLI版本、translate-server帮助及缺少付费密钥时的缓存复用通过。Node适配器限速调整后的6组相关测试再次通过。
- 浏览器刷新后5条映射仍可复用，切换有道/百度/Google均显示正确的环境变量字段；已缓存名称在代理关闭后仍能生成。未进行真实付费账户鉴权实测。

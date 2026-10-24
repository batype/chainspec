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

## 2.3 配置归类、文档连接与认证

- 默认只展开常用配置；分组命名、翻译服务、CLI与导出按需展开，JSON预览按钮常驻。文档URL从编辑器移至连接弹窗，粘贴和文件导入入口保留。
- `npm test` 25组全部通过，包含原有22组SDK类型、runtime/SWR、CLI更新保护、翻译及缓存回归。新增配置拒绝明文凭据/错误环境变量/重复头，UTF-8 Basic、Bearer+自定义头、401/403、凭据重定向限制，以及CLI在HTTP读取前载入.env；缺少凭据不会请求网络。原fetchDocument的signal位置兼容，长度/流式限额及取消保持。
- 认证端到端使用本地合成文档、测试账号/Token，未调用用户业务接口。浏览器Basic获取成功；再次打开账号密码为空；Bearer+X-API-Key获取并生成成功；403原因显示在弹窗；慢请求取消关闭且保留输入。导出的ZIP版本2.3.0，sourceRequest只有环境变量引用，所有文件均无本次测试Token/API Key值。
- 桌面亮暗主题及390×844手机尺寸实际截图检查通过；弹窗内容独立滚动，底部操作始终可见；URL自动聚焦，关闭返回入口。临时视口已重置。真实SSO/第三方Cookie场景依赖目标站及浏览器策略，未以用户真实登录账号验证。
- `npm run build`通过。项目外安装30文件tarball，CLI版本、带Basic的fetchDocument与公开TypeScript声明检查通过；包中只包含生成器与空白示例模板。最后的原始headers错误脱敏修改通过3组认证专项复测，未改SDK请求/Hook参数约定。

## 3.0 useRequest 自动、手动与刷新

- `npm test` 35组全部通过：保留已有25组SDK参数/类型/runtime/SWR/CLI/连接认证/翻译缓存回归，写操作手动旧用例改为显式useMutation。新增10组覆盖GET/POST/PUT/PATCH/DELETE默认自动、enabled:false不请求、trigger/refresh数据与loading、body缓存隔离、稳定函数在effect调用、required body延迟类型、null阻止手动、失败状态/恢复、并发旧结果不覆盖新body、enabled切换、空204不重复与不残留loading、runtime和局部/全局SWR回调。
- 生产构建通过。普通SDK的request参数协议不变；新行为仅在重新生成的React Hook生效。v3迁移文档明确旧写useRequest需加enabled:false或改useMutation；npm包包含迁移文档。
- 真实浏览器使用合成SDK与本地模拟适配器，POST首屏请求1次；关闭自动后trigger(newBody)、refresh、useEffect回调依次各发1次且复用body。手动模式改参数不请求，重新开启只发1次；模拟失败显示error，refresh后恢复并清除error。生产构建无新控制台错误；开发服务器首次依赖预构建热重载有React重复模块日志，生产构建单React实例验证正常。未向业务接口发请求。
- 网页POST Hook预览显示默认enabled:true、refresh与enabled:false的完整类型示例。实际SDK ZIP manifest为3.0.0，新hooks和SDK说明一致。
- 项目外独立安装最终31文件tarball及React/SWR/TypeScript依赖通过。根生成器API与CLI版本3.0.0、迁移文档可读取；CLI实际生成6操作/3模型SDK。网页下载ZIP与CLI生成的两份完整TypeScript SDK，使用独立安装依赖严格编译通过；未执行任何业务请求。

## 3.1 Node、Next.js 与 Vite React SSR

- 普通 index/node 入口不导入 React/SWR，React/hooks 入口保留 use client。新增独立 Node / React TypeScript 构建配置、私有 ESM 包元数据与可选 React/SWR peerDependencies，编译产物提供 JS 和 .d.ts。原 request/useRequest 入参、v3 默认自动请求以及 trigger/refresh 保持不变。
- 独立系统临时目录中没有 React/SWR，生成 Node 入口及 tsconfig.node.json 严格编译并实际运行通过；编译期拒绝 useRequest 和缺失 path，运行期没有 Hook。另以 @types/node 22.19、lib:ES2022 且不加载 DOM 验证已编译 SDK 的公共声明；HeadersInit 从宿主 Fetch 推导。自定义 Fetch 保留 headers、signal、序列化、解码和前后置钩子；完整 request 适配器仍优先。
- 自动测试验证 React renderToString 不触发 Hook 请求、读取 fallbackData、并发 Alice/Bob 预取数据隔离；Vite 真实浏览器构建与 SSR 构建、执行 SSR bundle 均通过。预览环境测试验证 Node/SSR 使用 request、Next.js 客户端带边界并导入 dist。
- Next.js 16.4.3 默认 Turbopack 的初次测试暴露 .js → .ts 源码解析不兼容；最终采用生成配置构建 dist，无全局 extensionAlias。真实 App Router 工程完成生产构建和 TypeScript 检查，Server Component 使用 node/dist 请求预取，Client Component 使用 React/dist 和 fallbackData 接管。
- 真实浏览器分别验证 Next.js App Router 与 Vite 8.3.5 React SSR：首次呈现服务端预取结果，revalidateOnMount:false 下 hydration 不发送客户端重复请求；点击 refresh 后各发送一次客户端请求并更新数据。两页均无 hydration/控制台错误。仅调用隔离的 loopback 合成 API，未调用用户业务接口或使用真实凭据。测试 Node 为 24.13.0；CI 仍使用 Node 22。未验证 Next.js Edge runtime、Vue/Svelte SSR 或其他 React/Next.js 版本。
- CLI --update 的额外文件保护保持；SDK 内产生 dist 后会被视为额外文件，持续生成场景按环境指南把 --outDir 设置到生成目录之外，或使用新的输出目录。不会为适配构建而放宽覆盖保护。

- 最终 npm test 43 项通过，生产构建及项目外 32 文件 tarball 的离线安装、Node API、CLI 版本检查通过。

## 3.2 按技术栈生成、预览和下载

- 网页默认 React / Vite，配置表单与工作台共用 target；支持 Node.js、通用浏览器、React / Vite、Next.js、Vite React SSR 与完整 SDK 兼容模式。切换 target / Hooks 复用完整的页面内存结果，不重新获取、解析或翻译。修改命名空间仍会停用旧结果的下载。
- `npm test` 49 项全部通过，保留原 43 项回归。新增 6 项覆盖文件与依赖闭包、包导出、清单、网页筛选和直接生成的逐字节一致性；五个技术栈实际编译并运行 request；GET/POST-only README 示例严格类型检查；非法 target / React 无 Hooks 在联网前拒绝；CLI 参数覆盖配置、切换技术栈更新及手改文件保护。
- `npm run build` 与 `git diff --check` 通过。请求与 Hook 模板未修改。CLI / Node API 省略 target 时保持 all；Node / browser 自动不生成 React 文件或依赖；Next / Vite SSR 同时保留本技术栈需要的服务端与客户端入口。
- 浏览器实际下载 Node、React、Next ZIP，并用包内配置、同一合成文档运行 CLI，SDK 文件内容逐字节一致。工作台只显示所选入口与环境示例，JSON 配置随选择同步。390×844 手机暗色与桌面亮色检查通过，下载控件在窄屏纵向排列；临时视口已重置，浏览器无警告或错误日志。未调用业务接口。
- npm tarball 检查 35 文件，只含生成器、文档及空白配置示例；在项目外独立离线安装，公开 API 的所有 target 和已安装 CLI 的 Node 生成验证通过。注册表发布状态以正式发布结果为准。

## 3.2.1 技术栈客户端指令检查

- 复现 3.2.0 React / Vite 生产构建：可成功构建，但 index.ts、react.ts、hooks.ts 会报告 MODULE_LEVEL_DIRECTIVE。该指令是 RSC 边界，常规 Vite SPA / SSR 不需要。
- React / Vite、Vite SSR 的源码移除顶层 use client，README 和预览示例同步；Next.js 及 all 的 React/Hooks 入口保留，Node/browser 及通用服务端入口不引入该指令。React/Hooks 实现与兼容模式仅差这一行，未改请求或 Hook 逻辑。
- `npm test` 51 项通过，含原49项回归及按技术栈的指令、编译产物保留、Vite SPA / SSR 真实生产构建检查。SSR 产物在独立 production 进程渲染两个用户的首屏数据，服务端 request 各一次，Hook 渲染请求次数为0。SWR 自身的指令警告不作为 SDK 警告；不在用户配置中屏蔽警告。
- 独立 Next.js 16.4.3 App Router 工程使用 next 目标，SDK TypeScript 构建及默认 Turbopack 生产构建、类型检查通过，React 入口在编译后保留客户端指令。
- 网页实际下载 React SDK 3.2.1，index/react/hooks、README 无 use client 指令；切换 Next.js 源码保留客户端指令。生产构建与差异检查通过。

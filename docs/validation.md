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

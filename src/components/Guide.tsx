import { useEffect, useState, type ReactNode } from "react";
import type { SDKTarget } from "../core/model";
import { SDK_TARGETS } from "../core/targets";
import {
  guideChapters,
  guideConfig,
  guideBuildCommand,
  guideDependencies,
  guideIntegration,
  requestExample,
  hookExample,
  middlewareExample,
  type GuideChapter,
} from "../guide-content";
import Code from "./Code";

function Sample({ file, code }: { file: string; code: string }) {
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [code]);
  return (
    <div className="docs-code">
      <div className="docs-code-heading">
        <span>{file}</span>
        <button
          type="button"
          aria-label={`复制 ${file}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setNotice("已复制");
            } catch {
              setNotice("复制失败，请手动选择代码");
            }
          }}
        >
          复制代码
        </button>
      </div>
      <Code text={code} limit={180} />
      <span className="docs-copy-status" role="status">
        {notice}
      </span>
    </div>
  );
}
function Note({ children }: { children: ReactNode }) {
  return <aside className="docs-note">{children}</aside>;
}
const repo = "https://github.com/batype/chainspec";
export default function Guide({
  route,
  defaultTarget,
}: {
  route: string;
  defaultTarget: SDKTarget;
}) {
  const query = new URLSearchParams(route.split("?")[1] ?? "");
  const chapter =
    guideChapters.find((item) => item.id === query.get("section")) ??
    guideChapters[0];
  const profile =
    SDK_TARGETS.find((item) => item.value === query.get("target")) ??
    SDK_TARGETS.find((item) => item.value === defaultTarget)!;
  const target = profile.value;
  const index = guideChapters.findIndex((item) => item.id === chapter.id);
  const href = (section: GuideChapter, selected: SDKTarget = target) =>
    `#/guide?${new URLSearchParams({ section, target: selected })}`;
  useEffect(() => {
    window.scrollTo(0, 0);
    document
      .getElementById("docs-section-title")
      ?.focus({ preventScroll: true });
  }, [chapter.id]);
  function contents() {
    switch (chapter.id) {
      case "overview":
        return (
          <>
            <p className="docs-lead">
              ChainSpec 将 Swagger / OpenAPI JSON 转成可读、有 TypeScript 类型的
              SDK，让你用一条调用链访问接口。
            </p>
            <div className="docs-flow" aria-label="从规范到调用的流程">
              {[
                "OpenAPI JSON",
                "ChainSpec 生成器",
                "TypeScript SDK",
                "你的应用",
              ].map((name, i) => (
                <div key={name}>
                  <small>0{i + 1}</small>
                  <strong>{name}</strong>
                  <span>
                    {
                      [
                        "接口与模型",
                        "解析 · 命名 · 生成",
                        "源码 · 类型 · 配置",
                        "request / Hooks",
                      ][i]
                    }
                  </span>
                </div>
              ))}
            </div>
            <Sample
              file="调用链长什么样"
              code={`API.main.users.getUser.request({ path: { id: '42' } });\nAPI.main.users.getUser.useRequest({ path: { id: '42' } });`}
            />
            <p>
              <code>main</code> 是可配置的命名空间，<code>users</code>{" "}
              是控制器分组，<code>getUser</code> 来自 operationId
              或路径规则。上方是站内合成示例；接入真实文档时，以生成的调用名、参数和返回类型为准。
            </p>
            <h3>先分清两件东西</h3>
            <div className="docs-table">
              <table>
                <thead>
                  <tr>
                    <th>内容</th>
                    <th>安装 / 保存在哪里</th>
                    <th>什么时候运行</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>@batype/chainspec</code>
                    </td>
                    <td>项目 devDependencies</td>
                    <td>开发阶段读取文档、生成 SDK</td>
                  </tr>
                  <tr>
                    <td>生成的 SDK 源码</td>
                    <td>
                      例如 <code>src/api/</code>
                    </td>
                    <td>由你的应用导入，调用时发送业务请求</td>
                  </tr>
                  <tr>
                    <td>JSON 生成配置</td>
                    <td>
                      <code>chainspec.config.json</code>
                    </td>
                    <td>网页与 CLI 复用，同一规则重复生成</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Note>
              npm 包是生成器，不能写成{" "}
              <code>import … from '@batype/chainspec/react'</code>{" "}
              来访问业务接口。业务客户端来自生成目录；
              <code>@batype/chainspec/node</code> 是生成器的翻译适配器。
            </Note>
            <h3>网页负责什么，应用负责什么？</h3>
            <p>
              网页在本地 Worker
              中解析与生成。工作台支持真实请求与模拟演示；导入业务文档后点击运行会通过浏览器 Fetch 调用接口，可在请求设置填写业务地址、Bearer / Basic 和 Cookie 选项。真实 Hook 自动请求需手动开启；认证仅保留在工作台内存，不进入配置或工作包。真实调用需目标站允许 CORS 和认证，模拟模式不发送 HTTP。可选翻译只发送缺失的分组名。下载后的
              SDK 使用应用配置的 Fetch 或请求适配器，执行真实请求。
            </p>
            <p>
              SDK 提供参数与响应类型、自定义请求、前后置钩子，以及可选 SWR
              Hooks。业务认证、服务端数据校验、重试策略与 Token 刷新由应用实现。
            </p>
            <a className="docs-text-link" href={href("quickstart")}>
              开始安装与生成 →
            </a>
          </>
        );
      case "quickstart":
        return (
          <>
            <p className="docs-lead">
              推荐把配置放进代码库，接口更新后运行同一条命令。当前示例目标为{" "}
              <strong>{profile.label}</strong>，可在右上角切换。
            </p>
            <div className="docs-step">
              <span>01</span>
              <div>
                <h3>准备文档与生成器</h3>
                <p>
                  CLI 需要 Node.js 22.14+。在已有项目根目录保存{" "}
                  <code>openapi.json</code>，也可以在配置中使用可访问的 JSON
                  链接。
                </p>
              </div>
            </div>
            <Sample
              file="项目根目录 · terminal"
              code="npm install -D @batype/chainspec@^3.2.1"
            />
            <div className="docs-step">
              <span>02</span>
              <div>
                <h3>保存一份生成配置</h3>
                <p>
                  本地 input / output
                  路径相对于配置文件。此示例关闭自动翻译；若使用中文
                  Tag，可手工设置 controllerNames，或再开启翻译。
                </p>
              </div>
            </div>
            <Sample
              file="chainspec.config.json"
              code={JSON.stringify(guideConfig(target), null, 2)}
            />
            <div className="docs-step">
              <span>03</span>
              <div>
                <h3>生成并接入</h3>
                <p>
                  第一次生成使用不存在的新目录。成功后进入下一章，按照{" "}
                  {profile.label} 的入口和构建方式导入。
                </p>
              </div>
            </div>
            <Sample
              file="首次生成 · terminal"
              code="npx chainspec --config chainspec.config.json"
            />
            <a className="docs-text-link" href={href("integration")}>
              查看 {profile.label} 接入代码 →
            </a>
            <h3>接口更新以后</h3>
            <Sample
              file="重复生成 · terminal"
              code={`npx chainspec --config chainspec.config.json --update\n# 临时覆盖技术栈；建议首次使用不同的新目录：\nnpx chainspec --config chainspec.config.json --target ${target} --out ./src/api-new`}
            />
            <Note>
              <code>--update</code> 只更新未经手改、没有额外文件的 CLI
              生成目录。自定义客户端放在 <code>src/apiClient.ts</code>
              ，构建产物放在 <code>src/api-build/</code>，都位于生成目录之外。
            </Note>
            <details className="docs-details">
              <summary>也可以完全从网页开始</summary>
              <ol>
                <li>
                  进入“配置与生成”，导入文件、粘贴 JSON，或在“从链接导入”读取 JSON
                  链接。
                </li>
                <li>选择技术栈与分组规则，生成并进入工作台。</li>
                <li>
                  查看调用、类型与诊断，下载对应 ZIP。将其中 sdk 文件夹放到{" "}
                  <code>src/api/</code>。
                </li>
                <li>
                  保存包内配置，并补充对应的本地 JSON 文件或可访问
                  URL。网页的导出配置不包含整份业务文档。
                </li>
              </ol>
              <a href="#/configure" className="docs-text-link">
                打开生成器 →
              </a>
            </details>
          </>
        );
      case "integration":
        return (
          <>
            <p className="docs-lead">
              {profile.label}：{profile.description}。以下假设生成目录是{" "}
              <code>src/api/</code>，示例接口来自站内合成文档。
            </p>
            <h3>1. 准备应用依赖</h3>
            <Sample file="在应用根目录安装" code={guideDependencies(target)} />
            <p>
              {target === "node" || target === "browser"
                ? "此目标不需要 React 或 SWR。浏览器需要 Fetch、Headers 等现代 Web API。"
                : "已有 React 工程不必重复安装 React。Next.js / React 脚手架通常已经带有 React 与类型；SWR 是生成 Hook 所需的运行时依赖。"}
            </p>
            <h3>
              2.{" "}
              {["node", "next", "all"].includes(target)
                ? "先构建 SDK"
                : "使用 TypeScript 源码入口"}
            </h3>
            {["node", "next", "all"].includes(target) ? (
              <>
                <Sample
                  file="输出到生成目录之外"
                  code={guideBuildCommand(target)}
                />
                <p>
                  编译后的 JS 和类型声明位于 <code>src/api-build/</code>
                  。Next.js 使用这些产物，兼容默认 Turbopack；Node
                  示例可直接运行编译后的 JS。
                </p>
              </>
            ) : (
              <p>
                Vite 可以把源码中的 .js 引用解析到对应 .ts 文件，无需单独构建
                SDK。普通浏览器项目若不使用 TypeScript 打包器，可用{" "}
                <code>{guideBuildCommand(target)}</code> 生成 JS，再改为导入
                api-build 下的入口。
              </p>
            )}
            {target === "node" && (
              <p>
                Node 示例采用 ESM：项目 package.json 的 type 应为
                module。CommonJS 工程请使用自己的 TypeScript 构建配置。
              </p>
            )}
            <h3>3. 创建客户端并调用</h3>
            <Note>
              将 <code>https://api.example.com</code>{" "}
              换成业务地址，并按生成的类型修改接口名与参数。复制示例不会自动执行请求；在你的应用运行代码时才会访问接口。
            </Note>
            {guideIntegration(target).map((sample) => (
              <Sample key={sample.file} {...sample} />
            ))}
            {target === "vite-ssr" && (
              <p>
                在你已有的 SSR 服务端加载器调用 <code>loadUser(id)</code>
                ，再将结果传给{" "}
                <code>&lt;UserRoot id=… initialUser=… /&gt;</code>。服务端 HTML
                注入与客户端 hydrateRoot 由所用 SSR 框架组织。
              </p>
            )}
            {target === "all" && (
              <p>
                完整模式同时保留通用与 React 入口，上例分别展示 Node 与 Next.js
                客户端组件。普通 Vite 工程可直接使用{" "}
                <code>src/api/react.js</code> 源码入口。
              </p>
            )}
            <p>
              Node 与通用入口只提供 request；React 入口同时提供
              request、useRequest 与 useMutation。Next.js 的 Server Component
              只能使用 request。
            </p>
            <a className="docs-text-link" href={href("requests")}>
              了解参数、自动请求与刷新 →
            </a>
          </>
        );
      case "requests":
        return (
          <>
            <p className="docs-lead">
              request 返回 Promise；useRequest 由 SWR
              管理状态与缓存。入参按文档是否声明 body 固定位置，和 HTTP
              方法名称无关。
            </p>
            <div className="docs-table">
              <table>
                <thead>
                  <tr>
                    <th>文档声明</th>
                    <th>request / useRequest</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>没有请求体</td>
                    <td>
                      <code>(params, options)</code>
                    </td>
                  </tr>
                  <tr>
                    <td>声明请求体</td>
                    <td>
                      <code>(params, body, options)</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              params 包含 path / query / cookies，path 与 query
              可同时出现；headers、signal 与拦截器位于
              options。没有参数时可用空对象占位；可选 body 暂不传时用 undefined
              保留位置。
            </p>
            <Sample file="request 入参示例" code={requestExample} />
            <h3>useRequest 什么时候请求？</h3>
            <div className="docs-table">
              <table>
                <thead>
                  <tr>
                    <th>调用方式</th>
                    <th>行为</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>useRequest(…)</code>
                    </td>
                    <td>默认自动请求，包括 POST / PUT / PATCH / DELETE</td>
                  </tr>
                  <tr>
                    <td>
                      <code>enabled: false</code>
                    </td>
                    <td>关闭自动来源，用 trigger / refresh 手动请求</td>
                  </tr>
                  <tr>
                    <td>
                      <code>trigger(newBody?)</code>
                    </td>
                    <td>执行请求，可提交并绑定新 body</td>
                  </tr>
                  <tr>
                    <td>
                      <code>refresh()</code>
                    </td>
                    <td>使用当前 params 和最近绑定的 body 重新请求</td>
                  </tr>
                  <tr>
                    <td>
                      <code>useMutation(…)</code>
                    </td>
                    <td>始终手动触发，适合提交与删除</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              以下 Hook 示例仅适用于 React 入口，在组件或自定义 Hook
              顶层调用。客户端实例来自“技术栈接入”的 React / Vite 示例。
            </p>
            <Sample file="src/ManualActions.tsx" code={hookExample} />
            <Note>
              自动不等于每次 render 都请求。SWR 按参数、body
              和身份作用域等组成的缓存键管理请求。非 GET/HEAD
              默认关闭聚焦、重连、轮询与错误自动重试；需要时可显式配置 swr。null
              params 同时暂停自动和手动请求。
            </Note>
            <p>
              trigger / refresh 引用稳定，可用于 effect
              依赖或业务回调。手动失败默认拒绝 Promise，使用 try/catch 或
              catch；需要只通过状态处理时使用{" "}
              <code>trigger(body, &#123; throwOnError: false &#125;)</code>
              。mutate 保留 SWR 缓存接口，明确重新请求请使用 refresh / trigger。
            </p>
          </>
        );
      case "ssr":
        return (
          <>
            <p className="docs-lead">
              SSR 的首屏取数由服务端 request 完成，再把可序列化结果交给
              React。Hook 负责读取首屏数据与客户端后续请求。
            </p>
            <div className="docs-flow" aria-label="SSR 接入流程">
              {[
                "服务端 request",
                "序列化结果",
                "fallbackData",
                "客户端 refresh",
              ].map((name, i) => (
                <div key={name}>
                  <small>0{i + 1}</small>
                  <strong>{name}</strong>
                </div>
              ))}
            </div>
            <h3>Next.js 与 Vite SSR 的区别</h3>
            <div className="docs-table">
              <table>
                <thead>
                  <tr>
                    <th>环境</th>
                    <th>服务端</th>
                    <th>React 层</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Next.js</td>
                    <td>Server Component / Route Handler 中 request</td>
                    <td>
                      客户端边界内调用 Hook，Client Component 仍可能预渲染
                    </td>
                  </tr>
                  <tr>
                    <td>常规 Vite SSR</td>
                    <td>服务端 loader 预取</td>
                    <td>共享组件渲染 fallbackData，客户端挂载后接管</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ol className="docs-prose-list">
              <li>每个入站请求创建独立的服务端客户端，按当前请求添加认证。</li>
              <li>
                传递输出数据，不能把 API 实例、函数、服务端 Token 或 Cookie
                传进浏览器。
              </li>
              <li>
                每棵 React 渲染树创建稳定客户端和独立 SWRConfig
                缓存，避免跨用户共享。
              </li>
              <li>
                首屏已预取时使用 fallbackData 和 revalidateOnMount:
                false，避免挂载后立即重复请求。
              </li>
              <li>
                首屏数据必须匹配当前参数；切换 id 时更新边界或仅为匹配的 key
                提供初始数据。
              </li>
            </ol>
            <Note>
              <code>"use client"</code> 是 React Server Components
              的边界指令。Next.js / all 的 React 入口保留；React / Vite 与常规
              Vite SSR 目标不生成。它不会在普通 Vite
              中自动组织服务端和客户端代码。
            </Note>
            <div className="docs-actions">
              <a href={href("integration", "next")}>查看 Next.js 完整示例 →</a>
              <a href={href("integration", "vite-ssr")}>查看 Vite SSR 示例 →</a>
            </div>
            <p>
              优先为 GET 读取操作做 SSR
              预取；不会为了展示首屏而执行写操作。Next.js 的 fetch
              缓存策略可通过客户端配置中的 fetch 包装函数控制。
            </p>
            <p className="docs-sources">
              官方参考：
              <a
                href="https://nextjs.org/docs/app/api-reference/directives/use-client"
                target="_blank"
                rel="noreferrer"
              >
                Next.js 客户端边界 ↗
              </a>{" "}
              ·{" "}
              <a
                href="https://vite.dev/guide/ssr.html"
                target="_blank"
                rel="noreferrer"
              >
                Vite SSR ↗
              </a>{" "}
              ·{" "}
              <a
                href="https://swr.vercel.app/docs/with-nextjs"
                target="_blank"
                rel="noreferrer"
              >
                SWR / Next.js ↗
              </a>
            </p>
          </>
        );
      case "configuration":
        return (
          <>
            <p className="docs-lead">
              生成配置决定代码如何组织；客户端配置决定真实请求怎样发送。文档读取的认证与业务接口认证是两条独立链路。
            </p>
            <h3>baseUrl 的优先级</h3>
            <ol className="docs-prose-list">
              <li>
                运行时{" "}
                <code>createAPI / createReactAPI(&#123; baseUrl &#125;)</code>{" "}
                的显式值。
              </li>
              <li>
                生成配置中的 baseUrl（网页“覆盖服务地址”或 CLI --base-url）。
              </li>
              <li>
                JSON 顶层第一个 servers.url；Swagger 2 使用 schemes / host /
                basePath。
              </li>
              <li>
                都没提供时保留相对路径；浏览器按页面环境解析，Node 请提供绝对
                HTTP(S) 地址。
              </li>
            </ol>
            <p>
              空字符串也是显式配置值；操作级 / 路径级 servers
              仅诊断，不自动创建多客户端。移除公共路径前缀只改变控制器命名，不改变请求
              URL。
            </p>
            <h3>复用自己的请求层和拦截器</h3>
            <Sample
              file="src/customClient.ts（通用入口示例）"
              code={middlewareExample}
            />
            <p>
              全局处理先于单次调用处理，异步依次执行，错误继续抛出。afterResponse
              若解包或改写数据，返回值要与文档声明的类型一致。更换用户 /
              租户时更新 cacheScope 并清理应用 SWR 缓存，不把 Token 写进
              cacheScope。
            </p>
            <details className="docs-details">
              <summary>读取需要认证的 OpenAPI JSON</summary>
              <p>
                网页标题旁的“从链接导入”支持 Basic、Bearer、自定义请求头与已有登录
                Cookie；CORS、SameSite
                和目标站权限仍然适用。真实凭据只用于本次读取，不导出到 SDK。CLI
                使用环境变量名引用凭据：
              </p>
              <Sample
                file="chainspec.config.json 中的 sourceRequest"
                code={JSON.stringify(
                  {
                    sourceRequest: {
                      auth: { type: "bearer", tokenEnv: "OPENAPI_TOKEN" },
                    },
                  },
                  null,
                  2,
                )}
              />
              <p>
                将真实值放到配置旁的 .env，或系统环境变量；CLI 可通过 --env-file
                指定文件。不要把 .env 提交到 Git。
              </p>
            </details>
            <details className="docs-details">
              <summary>中文分组与翻译缓存</summary>
              <p>
                中文 Tag 可用 controllerNames 映射为英文调用名，也可配置
                MyMemory、有道、百度或 Google
                翻译。已有映射优先，成功结果写回配置 /
                名称缓存，重复生成可复用。网页带密钥服务通过本地或自建代理调用，密钥保留在你的环境中。
              </p>
              <Sample
                file="配置中的分组映射"
                code={JSON.stringify(
                  {
                    groupBy: "tag",
                    controllerNames: { 用户管理: "users" },
                    translateNames: false,
                  },
                  null,
                  2,
                )}
              />
              <a
                className="docs-text-link"
                href={`${repo}#22-自动翻译api-key-与名称缓存`}
                target="_blank"
                rel="noreferrer"
              >
                查看翻译服务与环境变量配置 ↗
              </a>
            </details>
            <p>
              显式 CLI 参数优先于 JSON；未指定 target 的旧配置保持 all。node /
              browser 自动关闭 Hooks，react 必须开启 Hooks；next / vite-ssr
              可关闭 Hooks 只生成请求层。
            </p>
          </>
        );
      case "faq":
        return (
          <>
            <p className="docs-lead">
              先看工作台的“诊断报告”，再确认文档、所选技术栈与实际运行环境是否一致。
            </p>
            {[
              [
                "为什么 JSON 链接获取失败？",
                "应填写返回 OpenAPI JSON 的地址，不能填写 Swagger UI HTML 页面。401/403 检查文档认证；浏览器跨域受 CORS 约束。可下载 JSON 导入，或在有权限的环境使用 CLI。",
              ],
              [
                "为什么 Node 没有 useRequest？",
                "Node 与通用浏览器目标只提供 request。需要 React Hook 时选择 React / Vite、Next.js 或 Vite React SSR，并安装 SWR。",
              ],
              [
                "为什么下载的源码使用 .js 导入，却只有 .ts 文件？",
                "这是 TypeScript ESM 的源码约定。Vite 和 TypeScript 可将 .js 引用解析到 .ts；Node / Next.js 示例先构建成真实 JS，再导入 api-build。不要直接把未构建的 .js 源码路径交给 Node。",
              ],
              [
                "旧 SDK 里的 use client 会让 Vite 不能运行吗？",
                "通常可以正常使用，但会产生模块指令警告。3.2.1 起 React / Vite 与 Vite SSR 目标已移除多余指令，Next.js 客户端入口保留。SWR 自身仍可能包含相同指令。",
              ],
              [
                "为什么 useRequest 会自动提交 POST？",
                "v3 所有方法的 useRequest 默认自动请求。提交、删除等事件操作使用 useMutation，或 enabled: false 后通过 trigger 请求。旧版 v2 的手动调用需要迁移。",
              ],
              [
                "为什么 --update 拒绝覆盖？",
                "生成目录中存在手改、其他额外文件或不匹配的清单。正常的 dist 会保留，更新源码后需重新构建。保留手工文件并改用新的输出目录，不强行覆盖。自定义代码与构建产物放在生成目录外；网页解压目录不是 CLI 管理目录，首次 CLI 请选新目录。",
              ],
              [
                "为什么响应是 unknown，类型没有补全？",
                "接口文档缺少响应 Schema 或有未解析模型时会使用 unknown 并记录诊断。补全后端文档后重新生成；TypeScript 类型本身不会验证真实响应。",
              ],
              [
                "支持哪些文档，内容会保存在哪里？",
                "支持 Swagger 2、OpenAPI 3.0/3.1 JSON 常见子集，本地引用，输入最大 8 MiB。YAML、外部引用与复杂 Schema 需先处理。网页文档与生成结果仅在当前页面内存，刷新需重新导入；切换本应用页面不会清空结果。",
              ],
            ].map(([title, text], i) => (
              <details className="docs-details" key={title} open={i === 0}>
                <summary>{title}</summary>
                <p>{text}</p>
              </details>
            ))}
            <a
              className="docs-text-link"
              href={`${repo}/blob/main/docs/limits.md`}
              target="_blank"
              rel="noreferrer"
            >
              完整支持边界与限制 ↗
            </a>
          </>
        );
      case "development":
        return (
          <>
            <p className="docs-lead">
              这一章用于运行和维护 ChainSpec 生成器本身。只想在业务项目中使用
              SDK，可直接阅读“安装与生成”。
            </p>
            <Sample
              file="获取并启动生成器"
              code={`git clone https://github.com/batype/chainspec.git\ncd chainspec\nnpm ci\nnpm test\nnpm run dev\n# http://127.0.0.1:4184/chainspec/`}
            />
            <h3>源码如何组织</h3>
            <div className="docs-table">
              <table>
                <thead>
                  <tr>
                    <th>位置</th>
                    <th>职责</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "src/App.tsx / components",
                      "React 页面、配置、工作台与接入指南",
                    ],
                    ["src/core", "独立于 React 的解析、类型和代码生成核心"],
                    ["src/workers", "网页生成 Worker、进度与取消"],
                    ["templates", "生成 SDK 的请求运行时与 SWR Hooks"],
                    ["bin", "npm CLI、翻译适配器与本地代理"],
                    ["tests", "类型、运行时、框架构建与 CLI 回归验证"],
                  ].map(([path, description]) => (
                    <tr key={path}>
                      <td>
                        <code>{path}</code>
                      </td>
                      <td>{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Sample
              file="生产构建与预览"
              code={`npm run build\nnpm run preview\n# http://127.0.0.1:4185/chainspec/`}
            />
            <p>
              Web 使用 React + Vite，base 为 /chainspec/。GitHub Actions 在 main
              推送后运行测试、构建与 Pages 部署。SDK 生成器和业务 SDK
              的构建彼此独立，修改业务 JSON 不需要重新开发生成器。
            </p>
            <div className="docs-actions">
              <a href={repo} target="_blank" rel="noreferrer">
                查看 GitHub 源码 ↗
              </a>
              <a
                href={`${repo}/blob/main/LICENSE`}
                target="_blank"
                rel="noreferrer"
              >
                MIT 许可证 ↗
              </a>
            </div>
          </>
        );
    }
  }
  return (
    <main className="docs-page" id="guide-page">
      <header className="docs-masthead">
        <div>
          <span className="eyebrow">CHAINSPEC / DOCUMENTATION</span>
          <h1 id="guide-title" tabIndex={-1}>
            从了解项目，到第一次调用。
          </h1>
          <p>项目解读、安装步骤和技术栈接入，沿着一条路径读完。</p>
        </div>
        <a href="#/configure" className="docs-start">
          打开生成器 ↗
        </a>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <span className="docs-nav-label">
            阅读目录 <small>8 CHAPTERS</small>
          </span>
          <nav aria-label="接入指南目录">
            {guideChapters.map((item, i) => (
              <a
                key={item.id}
                href={href(item.id)}
                aria-current={item.id === chapter.id ? "page" : undefined}
              >
                <span>0{i + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </div>
              </a>
            ))}
          </nav>
          <a
            className="docs-sidebar-source"
            href={`${repo}/blob/main/README.md`}
            target="_blank"
            rel="noreferrer"
          >
            README 原文 ↗
          </a>
        </aside>
        <article className="docs-article" aria-labelledby="docs-section-title">
          <div className="docs-section-heading">
            <div>
              <span className="docs-breadcrumb">接入指南 / 0{index + 1}</span>
              <h2 id="docs-section-title" tabIndex={-1}>
                {chapter.title}
              </h2>
            </div>
            <label htmlFor="docs-target">
              文档示例技术栈
              <select
                id="docs-target"
                value={target}
                onChange={(e) => {
                  window.location.hash = href(
                    chapter.id,
                    e.target.value as SDKTarget,
                  ).slice(1);
                }}
              >
                {SDK_TARGETS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="docs-content">{contents()}</div>
          <nav className="docs-pager" aria-label="章节翻页">
            {index > 0 ? (
              <a href={href(guideChapters[index - 1].id)}>
                <small>← 上一章</small>
                <strong>{guideChapters[index - 1].title}</strong>
              </a>
            ) : (
              <a href="#/configure">
                <small>← 返回</small>
                <strong>配置与生成</strong>
              </a>
            )}
            {index < guideChapters.length - 1 ? (
              <a href={href(guideChapters[index + 1].id)}>
                <small>下一章 →</small>
                <strong>{guideChapters[index + 1].title}</strong>
              </a>
            ) : (
              <a href="#/workspace">
                <small>接下来 →</small>
                <strong>SDK 工作台</strong>
              </a>
            )}
          </nav>
        </article>
      </div>
      <footer className="docs-footer">
        <span>ChainSpec · 文档依据当前 v3 SDK 行为整理</span>
        <a href={`${repo}/issues`} target="_blank" rel="noreferrer">
          反馈文档问题 ↗
        </a>
      </footer>
    </main>
  );
}

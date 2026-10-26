import { useMemo, useState } from "react";
import { SDK_TARGETS } from "../core/targets";
import type { GeneratedProject, SDKTarget } from "../core/model";
import { usage, type UsageEnvironment } from "../usage";
import Code from "./Code";
import Playground from "./Playground";
import IntegrationSteps from "./IntegrationSteps";
import { liveConnection, type LiveConnection } from "../playground-live";

type Props = {
  project: GeneratedProject;
  documentText: string;
  route: string;
  ready: boolean;
  onDownload: () => void;
  output: string; source: string; demo:boolean; onConfig:()=>void;
  target: SDKTarget;
  onTargetChange: (target: SDKTarget) => void;
};
const views = [
  "setup",
  "playground",
  "usage",
  "types.ts",
  "client.ts",
  "node.ts",
  "react.ts",
  "runtime.ts",
  "diagnostics",
] as const;
type View = (typeof views)[number];
export default function Workspace({
  project,
  documentText,
  route,
  ready,
  onDownload,
  target,
  onTargetChange,
  output,source,demo,onConfig,
}: Props) {
  const [savedConnection,setConnection] = useState<{document:string; baseUrl:string; value:LiveConnection}|null>(null);
  const defaultConnection = useMemo(()=>liveConnection(project.baseUrl),[documentText,project.baseUrl]);
  const connection = savedConnection?.document===documentText && savedConnection.baseUrl===project.baseUrl ? savedConnection.value : defaultConnection;
  const documentSession=useMemo(()=>Math.random().toString(36),[documentText,project.baseUrl]);
  const query = new URLSearchParams(route.split("?")[1] ?? "");
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [mode, setMode] = useState<"request" | "hook">("request"),
    [notice, setNotice] = useState(""),
    [chosenEnvironment, setEnvironment] =
      useState<UsageEnvironment>("universal");
  const targetEnvironments: UsageEnvironment[] =
    target === "node"
      ? ["node"]
      : target === "browser"
        ? ["universal"]
        : target === "react"
          ? ["react"]
          : target === "next"
            ? [
                "next-server",
                ...(project.files["react.ts"] ? ["next-client" as const] : []),
              ]
            : target === "vite-ssr"
              ? [
                  "vite-ssr",
                  ...(project.files["react.ts"] ? ["react" as const] : []),
                ]
              : [
                  "universal",
                  "node",
                  "react",
                  "next-server",
                  "next-client",
                  "vite-ssr",
                ];
  const environments = targetEnvironments.filter(
    (item) =>
      project.files["react.ts"] || !["react", "next-client"].includes(item),
  );
  const environment = environments.includes(chosenEnvironment)
    ? chosenEnvironment
    : environments[0];
  const targetLabel = SDK_TARGETS.find((item) => item.value === target)!.label;
  const serverExample = ["node", "next-server", "vite-ssr"].includes(
    environment,
  );
  const hooks = Object.hasOwn(project.files, "react.ts");
  const fallback =
    project.operations.find(
      (op) => op.method === "GET" && op.parameters.some((p) => p.in === "path"),
    ) ?? project.operations[0];
  const op =
    project.operations.find((op) => op.id === query.get("op")) ?? fallback;
  const view =
    views.includes(query.get("tab") as View) &&
    (["setup", "playground", "usage", "diagnostics"].includes(query.get("tab") ?? "") ||
      Object.hasOwn(project.files, query.get("tab") ?? ""))
      ? (query.get("tab") as View)
      : "setup";
  const document = useMemo(() => {
    try {
      return JSON.parse(documentText) as unknown;
    } catch {
      return {};
    }
  }, [documentText]);
  const filtered = useMemo(
    () =>
      project.operations.filter((op) =>
        `${op.id} ${op.summary} ${op.path} ${op.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [project, search],
  );
  const groups = new Map<string, typeof filtered>();
  for (const item of filtered.slice(page * 50, (page + 1) * 50)) {
    if (!groups.has(item.controller)) groups.set(item.controller, []);
    groups.get(item.controller)!.push(item);
  }
  const href = (tab: View, id = op?.id) =>
    `#/workspace?${new URLSearchParams({ ...(id ? { op: id } : {}), tab })}`;
  const warnings = project.diagnostics.filter(
    (d) => d.level === "warning",
  ).length;
  const code =
    view === "usage" && op
      ? usage(
          project,
          op,
          hooks && !serverExample ? mode : "request",
          environment,
          document,
        )
      : view === "diagnostics"
        ? JSON.stringify(project.diagnostics, null, 2)
        : (project.files[view] ?? "");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("代码已复制。");
    } catch {
      setNotice("剪贴板不可用，请选中代码手动复制。");
    }
  }
  function downloadCurrent() {
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/plain;charset=utf-8" }),
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download =
      view === "usage"
        ? `example-${target}.ts`
        : view === "diagnostics"
          ? "diagnostics.json"
          : view;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("当前文件已下载。");
  }
  return (
    <main className="workspace-page" id="workspace">
      <div className="workspace-heading">
        <div>
          <a href="#/configure" className="back-link">
            ← 返回配置
          </a>
          <h1 tabIndex={-1} id="workspace-title">
            SDK 工作台 <span>生成之后，立即体验。</span>
          </h1>
        </div>
        <div className="workspace-download">
          <label htmlFor="download-target">
            下载技术栈
            <select
              id="download-target"
              value={target}
              onChange={(e) => {
                setNotice("");
                onTargetChange(e.target.value as SDKTarget);
              }}
            >
              {SDK_TARGETS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={!ready}
            onClick={() => {
              onDownload();
              setNotice(
                `${targetLabel} SDK 已下载；ZIP 与 CLI 配置使用同一技术栈。`,
              );
            }}
          >
            ↓ 下载 {targetLabel} <span>.zip</span>
          </button>
        </div>
      </div>
      <p className="download-profile-note" role="status">
        {SDK_TARGETS.find((item) => item.value === target)?.description} ·{" "}
        {Object.keys(project.files).length} 个文件 · 预览、ZIP 与导出配置同步 <a className="workspace-guide-link" href={`#/guide?section=integration&target=${target}`}>查看接入步骤 →</a>
      </p>
      {!ready && (
        <p className="workspace-warning" role="status">
          输入或配置已有改动，当前展示上一次生成的结果。
          <a href="#/configure">返回配置重新生成 →</a>
        </p>
      )}
      <div className="workspace-meta">
        <strong>{project.title}</strong>
        <span>v{project.version || "—"}</span>
        <span>{project.operations.length} 个接口</span>
        <span>{project.schemaCount} 个模型</span>
        <a href={href("diagnostics")}>{warnings} 条提示</a>
        <span className="local-label">◉ 文档仅在本页内存</span>
      </div>
      <div className="workspace-layout">
        <aside className="explorer workspace-explorer" aria-label="接口导航">
          <div className="explorer-head">
            <strong>接口目录</strong>
            <span>{filtered.length}</span>
          </div>
          <label className="sr-only" htmlFor="workspace-search">
            搜索接口
          </label>
          <div className="search-box">
            <span>⌕</span>
            <input
              id="workspace-search"
              name="search"
              type="search"
              spellCheck={false}
              placeholder="搜索名称、路径…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="operation-list">
            {[...groups].map(([name, items]) => (
              <details open key={name}>
                <summary>
                  <span>⌄</span> {name}
                  <small>{items.length}</small>
                </summary>
                {items.map((item) => (
                  <a
                    href={href(view, item.id)}
                    key={item.id}
                    aria-current={item.id === op?.id ? "true" : undefined}
                    className={item.id === op?.id ? "selected" : ""}
                  >
                    <span
                      className={`method mini ${item.method.toLowerCase()}`}
                    >
                      {item.method}
                    </span>
                    <span>
                      <b>{item.name}</b>
                      <small>{item.summary || item.path}</small>
                    </span>
                  </a>
                ))}
              </details>
            ))}
            {!filtered.length && (
              <p className="no-results">没有匹配的接口，试试其他关键词。</p>
            )}
          </div>
          {filtered.length > 50 && (
            <div className="explorer-pagination">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                上一页
              </button>
              <span>
                {page + 1} / {Math.ceil(filtered.length / 50)}
              </span>
              <button
                type="button"
                disabled={(page + 1) * 50 >= filtered.length}
                onClick={() => setPage((n) => n + 1)}
              >
                下一页
              </button>
            </div>
          )}
          <div className="explorer-foot">
            API.<b>{project.namespace}</b>
            <br />
            选择接口，体验调用和返回类型。
          </div>
        </aside>
        <section className="workspace-content" aria-label="SDK 体验与源码">
          <nav className="workspace-tabs" aria-label="工作台视图">
            {views
              .filter(
                (tab) =>
                  ["setup", "playground", "usage", "diagnostics"].includes(tab) ||
                  Object.hasOwn(project.files, tab),
              )
              .map((tab) => (
                <a
                  key={tab}
                  href={href(tab)}
                  aria-current={view === tab ? "page" : undefined}
                >
                  {tab === "setup" ? "接入项目" : tab === "playground"
                    ? "◉ 交互体验"
                    : tab === "usage"
                      ? "接入示例"
                      : tab === "types.ts"
                        ? "类型定义"
                        : tab === "diagnostics"
                          ? "诊断报告"
                          : tab}
                </a>
              ))}
          </nav>
          {op ? (
            <div className="workspace-operation">
              <span className={`method ${op.method.toLowerCase()}`}>
                {op.method}
              </span>
              <code>{op.path}</code>
              <span>{op.summary}</span>
              {op.deprecated && <span>已废弃</span>}
            </div>
          ) : (
            <p className="no-results">
              该文档没有可生成的接口，可查看诊断报告。
            </p>
          )}
          {view === "setup" ? (op&&<IntegrationSteps project={project} op={op} document={document} target={target} output={output} source={source} demo={demo} ready={ready} onDownload={onDownload} onConfig={onConfig}/>) : view === "playground" ? (
            op && (
              <Playground
                key={`${documentSession}:${op.id}`}
                project={project}
                op={op}
                document={document}
                hooks={hooks}
                demo={demo}
                connection={connection}
                onConnection={value=>setConnection({document:documentText,baseUrl:project.baseUrl,value})}
              />
            )
          ) : (
            <div className="workspace-source preview-panel">
              <div className="workspace-source-heading">
                <strong>
                  {view === "usage"
                    ? "可复制到工程的完整接入示例"
                    : view === "diagnostics"
                      ? "文档与生成诊断"
                      : view}
                </strong>
                {view === "usage" && (
                  <label className="environment-picker">
                    运行环境
                    <select
                      value={environment}
                      onChange={(e) =>
                        setEnvironment(e.target.value as UsageEnvironment)
                      }
                    >
                      {environments
                        .filter(
                          (item) =>
                            hooks || !["react", "next-client"].includes(item),
                        )
                        .map((item) => (
                          <option key={item} value={item}>
                            {
                              {
                                universal: "通用 / Vite",
                                node: "Node.js",
                                react:
                                  target === "vite-ssr"
                                    ? "Vite SSR 客户端组件"
                                    : "React / Vite SPA",
                                "next-server": "Next.js 服务端",
                                "next-client": "Next.js 客户端组件",
                                "vite-ssr": "Vite SSR 服务端取数",
                              }[item]
                            }
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {view === "usage" && hooks && !serverExample && (
                  <div
                    className="mode-switch"
                    role="group"
                    aria-label="示例调用方式"
                  >
                    <button
                      type="button"
                      aria-pressed={mode === "request"}
                      onClick={() => setMode("request")}
                    >
                      request
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "hook"}
                      onClick={() => setMode("hook")}
                    >
                      useRequest
                    </button>
                  </div>
                )}
                <div className="source-file-actions">
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={downloadCurrent}
                  >
                    下载当前
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => void copy()}
                  >
                    复制代码
                  </button>
                </div>
              </div>
              {view === "diagnostics" ? (
                <div className="diagnostic-list">
                  {project.diagnostics.slice(0, 120).map((d, i) => (
                    <article key={i}>
                      <span className={d.level}>
                        {d.level === "warning" ? "!" : "i"}
                      </span>
                      <div>
                        <strong>{d.message}</strong>
                        {d.location && <code>{d.location}</code>}
                        <small>{d.code}</small>
                      </div>
                    </article>
                  ))}
                  {!project.diagnostics.length && <p>没有诊断提示。</p>}
                  {project.diagnostics.length > 120 && (
                    <p>显示前 120 条，完整报告包含在下载包中。</p>
                  )}
                </div>
              ) : (
                <Code text={code} limit={350} />
              )}
              <div className="preview-actions">
                <span>
                  下载包包含当前技术栈的源码与配置；类型用于编译检查，不代表运行时校验。
                </span>
              </div>
            </div>
          )}
          <p className="workspace-notice" role="status">
            {notice}
          </p>
        </section>
      </div>
    </main>
  );
}

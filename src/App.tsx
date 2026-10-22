import { useEffect, useMemo, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import type { GeneratedProject, GeneratorOptions } from "./core/model";
import { MAX_BYTES } from "./core/model";
import { exampleText } from "./example";
import Code from "./components/Code";
import { usage } from "./usage";
const defaults = {
  namespace: "main",
  groupBy: "path" as "path" | "tag",
  stripPrefix: "",
  baseUrl: "",
  hooks: true,
  aliases: "",
};
type Theme = "system" | "light" | "dark";
type Preview =
  | "usage"
  | "client.ts"
  | "types.ts"
  | "runtime.ts"
  | "react.ts"
  | "diagnostics";
function download(
  bytes: BlobPart,
  name: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("chainspec-theme");
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}
export default function App() {
  const [input, setInput] = useState(exampleText),
    [settings, setSettings] = useState(defaults),
    [result, setResult] = useState<GeneratedProject | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<Preview>("usage"),
    [mode, setMode] = useState<"request" | "hook">("request"),
    [theme, setTheme] = useState<Theme>(readTheme),
    [inputOpen, setInputOpen] = useState(true);
  const worker = useRef<Worker | null>(null),
    seq = useRef(0),
    editor = useRef<HTMLTextAreaElement>(null),
    edits = useRef(0),
    imports = useRef(0);
  const stateKey = JSON.stringify([input, settings]);
  const dirty = stateKey !== submitted;
  const ready = Boolean(result) && !dirty && !busy && !error;
  const options = (): GeneratorOptions => {
    const aliases: Record<string, string> = Object.create(null);
    for (const line of settings.aliases.split("\n").filter((l) => l.trim())) {
      const pos = line.indexOf("=");
      if (pos < 1 || !line.slice(pos + 1).trim())
        throw new Error("分组别名格式：原分组=新名称，每行一条");
      aliases[line.slice(0, pos).trim()] = line.slice(pos + 1).trim();
    }
    return {
      namespace: settings.namespace,
      groupBy: settings.groupBy,
      stripPrefix: settings.stripPrefix || undefined,
      baseUrl: settings.baseUrl || undefined,
      hooks: settings.hooks,
      controllerNames: aliases,
    };
  };
  const generate = () => {
    try {
      const opts = options();
      if (new TextEncoder().encode(input).length > MAX_BYTES)
        throw new Error("输入最大8 MiB");
      const id = ++seq.current;
      setBusy(true);
      setError("");
      setNotice("");
      setSubmitted(stateKey);
      worker.current?.postMessage({ id, input, options: opts });
    } catch (e) {
      setError(e instanceof Error ? e.message : "配置有误");
      editor.current?.focus();
    }
  };
  useEffect(() => {
    const w = new Worker(
      new URL("./workers/generate.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = ({
      data,
    }: MessageEvent<{
      id: number;
      result?: GeneratedProject;
      error?: string;
    }>) => {
      if (data.id !== seq.current) return;
      setBusy(false);
      setError(data.error ?? "");
      setResult(data.result ?? null);
      if (data.error) editor.current?.focus();
    };
    w.onerror = () => {
      setBusy(false);
      setResult(null);
      setError("本地生成线程发生错误，请刷新后重试。");
    };
    const id = ++seq.current;
    setBusy(true);
    setSubmitted(JSON.stringify([exampleText, defaults]));
    w.postMessage({
      id,
      input: exampleText,
      options: { namespace: "main", groupBy: "path", hooks: true },
    });
    return () => w.terminate();
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "dark" || (theme === "system" && media.matches)
          ? "dark"
          : "light";
    };
    apply();
    try {
      localStorage.setItem("chainspec-theme", theme);
    } catch {}
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (result && !result.operations.some((o) => o.id === selected))
      setSelected(
        (
          result.operations.find(
            (o) =>
              o.method === "GET" && o.parameters.some((p) => p.in === "path"),
          ) ??
          result.operations.find((o) => o.method === "GET") ??
          result.operations[0]
        )?.id ?? "",
      );
  }, [result, selected]);
  const op =
    result?.operations.find((o) => o.id === selected) ?? result?.operations[0];
  const filtered = useMemo(
    () =>
      result?.operations.filter((o) =>
        `${o.id} ${o.path} ${o.summary} ${o.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [],
    [result, search],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const o of filtered) {
      if (!map.has(o.controller)) map.set(o.controller, []);
      map.get(o.controller)!.push(o);
    }
    return map;
  }, [filtered]);
  const code = result
    ? preview === "usage" && op
      ? usage(result, op, settings.hooks ? mode : "request")
      : preview === "diagnostics"
        ? JSON.stringify(result.diagnostics, null, 2)
        : (result.files[preview] ?? "此入口已关闭；开启 SWR 后重新生成。")
    : "";
  const clear = () => {
    edits.current++;
    seq.current++;
    setInput("");
    setResult(null);
    setError("");
    setBusy(false);
    setNotice("当前输入与生成结果已清空。");
    setInputOpen(true);
  };
  const sample = () => {
    if (
      input.trim() &&
      input !== exampleText &&
      !confirm("载入示例会替换当前JSON，是否继续？")
    )
      return;
    edits.current++;
    setInput(exampleText);
    setError("");
    setNotice("合成示例已载入，点击生成。");
    setInputOpen(true);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const edit = edits.current,
      id = ++imports.current;
    try {
      if (file.size > MAX_BYTES) throw new Error("文件最大8 MiB");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (edit !== edits.current || id !== imports.current) return;
      edits.current++;
      setInput(text);
      setError("");
      setNotice("文件已在本地读入，点击生成SDK。");
      setInputOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件需为UTF-8 JSON");
    }
  };
  const copy = async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(code);
      setNotice("当前预览已复制。");
    } catch {
      setNotice("剪贴板不可用，请手动选中代码复制。");
    }
  };
  const exportZip = () => {
    if (!ready || !result) return;
    const entries = Object.fromEntries(
      Object.entries(result.files).map(([name, text]) => [
        `sdk/${name}`,
        strToU8(text),
      ]),
    );
    download(
      zipSync(entries, { level: 6 }).slice().buffer,
      "chainspec-sdk.zip",
      "application/zip",
    );
    setNotice("SDK已下载，包含完整类型、运行时、诊断和使用说明。");
  };
  const warnings =
    result?.diagnostics.filter((d) => d.level === "warning") ?? [];
  const update = (key: keyof typeof defaults, value: string | boolean) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <>
      <a className="skip" href="#studio">
        跳到生成器
      </a>
      <header className="topbar">
        <a className="brand" href="#top">
          <img
            src={`${import.meta.env.BASE_URL}icon.svg`}
            alt=""
            width="34"
            height="34"
          />
          <strong>ChainSpec</strong>
          <span>从接口到调用</span>
        </a>
        <nav aria-label="主导航">
          <a href="#studio">生成器</a>
          <a href="#guide">接入指南</a>
          <a
            href="https://github.com/batype/chainspec"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <label className="sr-only" htmlFor="theme">
          界面主题
        </label>
        <select
          id="theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">亮色模式</option>
          <option value="dark">暗色模式</option>
        </select>
      </header>
      <main id="top">
        <section className="hero">
          <div>
            <div className="eyebrow">
              <span className="pulse" /> OPENAPI → TYPESCRIPT SDK{" "}
              <span className="badge">LOCAL FIRST</span>
            </div>
            <h1>
              从一份规范，
              <br />
              到每一次<span>调用。</span>
            </h1>
            <p>
              导入 Swagger JSON，把接口变成有类型的链式 SDK。
              <br />
              请求由你掌控，React 交给 SWR。
            </p>
            <div className="hero-tags">
              <span>TypeScript 补全</span>
              <span>自定义请求与拦截器</span>
              <span>纯本地生成</span>
            </div>
          </div>
          <div className="chain-card" aria-label="链式调用示例">
            <div>
              <span className="small-caps">ONE CONTRACT. ONE CHAIN.</span>
              <span className="chain-icon">↳</span>
            </div>
            <p>
              <b>API</b>
              <em>.main</em>
              <span>.users</span>
              <span>.getUser</span>
            </p>
            <div className="chain-branches">
              <span>
                ↳ <strong>.request</strong>({"{ path }"}){" "}
                <small>Promise&lt;User&gt;</small>
              </span>
              <span>
                ↳ <strong>.useRequest</strong>({"{ path }"}){" "}
                <small>SWRResponse&lt;User&gt;</small>
              </span>
            </div>
            <footer>
              <i /> 类型跟着接口走，调用不再凭记忆。
            </footer>
          </div>
        </section>
        <section className="studio" id="studio" aria-label="SDK生成器">
          <div className="studio-toolbar">
            <div>
              <span className="step">01</span>
              <h2>构建你的调用方式</h2>
              <span className="local-label">◉ JSON 留在当前页面</span>
            </div>
            <div>
              <button type="button" className="text-button" onClick={sample}>
                载入示例
              </button>
              <button
                type="button"
                onClick={() => setInputOpen((v) => !v)}
                aria-expanded={inputOpen}
              >
                {inputOpen ? "收起输入 ↑" : "编辑输入 ↓"}
              </button>
              <button
                type="button"
                className="primary"
                onClick={generate}
                disabled={busy || !input.trim()}
              >
                {busy ? "正在生成…" : "生成 SDK"} <span>↗</span>
              </button>
            </div>
          </div>
          {inputOpen && (
            <div className="source-grid">
              <section className="source-panel">
                <div className="section-head">
                  <h3>
                    <span className="file-symbol">{`{ }`}</span> OpenAPI JSON
                  </h3>
                  <div>
                    <label className="import-file">
                      导入文件
                      <input
                        type="file"
                        accept=".json,.txt,application/json,text/plain"
                        onChange={(e) => {
                          void importFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={clear}
                    >
                      清空
                    </button>
                  </div>
                </div>
                <label htmlFor="spec" className="sr-only">
                  Swagger或OpenAPI JSON
                </label>
                <textarea
                  ref={editor}
                  id="spec"
                  value={input}
                  onChange={(e) => {
                    edits.current++;
                    setInput(e.target.value);
                    setError("");
                    setNotice("");
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      generate();
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  placeholder='{"openapi":"3.0.0","paths":{…}}'
                  aria-invalid={Boolean(error)}
                  aria-describedby="input-error"
                />
                <div className="editor-footer">
                  <span>
                    UTF-8 ·{" "}
                    {(new TextEncoder().encode(input).length / 1024).toFixed(1)}{" "}
                    KiB / 8 MiB
                  </span>
                  <span>⌘ / Ctrl + Enter</span>
                </div>
              </section>
              <section
                className="settings-panel"
                aria-labelledby="settings-title"
              >
                <h3 id="settings-title">
                  生成配置 <span>CONFIGURATION</span>
                </h3>
                <div className="settings-grid">
                  <label>
                    命名空间
                    <input
                      value={settings.namespace}
                      onChange={(e) => update("namespace", e.target.value)}
                      placeholder="main"
                      spellCheck={false}
                    />
                    <small>
                      API.{settings.namespace || "main"}.controller.method
                    </small>
                  </label>
                  <label>
                    控制器分组
                    <select
                      value={settings.groupBy}
                      onChange={(e) => update("groupBy", e.target.value)}
                    >
                      <option value="path">按路径分组</option>
                      <option value="tag">按首个 Tag 分组</option>
                    </select>
                  </label>
                  <label>
                    移除公共路径前缀
                    <input
                      value={settings.stripPrefix}
                      onChange={(e) => update("stripPrefix", e.target.value)}
                      placeholder="自动识别，如 /v1/api"
                      spellCheck={false}
                    />
                    <small>只影响分组，不改变请求 URL</small>
                  </label>
                  <label>
                    覆盖服务地址
                    <input
                      value={settings.baseUrl}
                      onChange={(e) => update("baseUrl", e.target.value)}
                      placeholder="使用文档中的 servers"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.hooks}
                    onChange={(e) => update("hooks", e.target.checked)}
                  />
                  <span>
                    <strong>生成 SWR Hooks</strong>
                    <small>查询缓存 + 手动触发写请求</small>
                  </span>
                  <span className="swr-mark">SWR ↗</span>
                </label>
                <details className="aliases">
                  <summary>自定义分组名称</summary>
                  <label className="sr-only" htmlFor="aliases">
                    分组别名，每行原名称等于新名称
                  </label>
                  <textarea
                    id="aliases"
                    value={settings.aliases}
                    onChange={(e) => update("aliases", e.target.value)}
                    placeholder={"users=members\n用户鉴权=auth"}
                    spellCheck={false}
                  />
                </details>
              </section>
            </div>
          )}
          <p className="error" role="alert" id="input-error">
            {error}
          </p>
          <div className="status" role="status" aria-live="polite">
            {notice ||
              (dirty && result
                ? "输入或配置已更改，请重新生成；下载与复制暂不可用。"
                : busy
                  ? "正在本地Worker中解析文档…"
                  : "")}
          </div>
          {result && (
            <>
              <div className="result-strip">
                <div>
                  <span className="step success">✓</span>
                  <div>
                    <strong>{result.title}</strong>
                    <small>
                      v{result.version || "—"} ·{" "}
                      {ready
                        ? "已生成，可导出"
                        : dirty
                          ? "结果对应上一次生成"
                          : "本地生成结果"}
                    </small>
                  </div>
                </div>
                <div className="counts">
                  <span>
                    <b>{result.operations.length}</b> 操作
                  </span>
                  <span>
                    <b>
                      {new Set(result.operations.map((o) => o.controller)).size}
                    </b>{" "}
                    分组
                  </span>
                  <span>
                    <b>{result.schemaCount}</b> 模型
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreview("diagnostics")}
                    className={warnings.length ? "warning-count" : ""}
                  >
                    {warnings.length} 条提示
                  </button>
                </div>
                <button
                  type="button"
                  className="export"
                  disabled={!ready}
                  onClick={exportZip}
                >
                  ↓ 下载完整 SDK <span>.zip</span>
                </button>
              </div>
              <div className="results">
                <aside className="explorer" aria-label="接口列表">
                  <div className="explorer-head">
                    <strong>接口导航</strong>
                    <span>{filtered.length}</span>
                  </div>
                  <label className="sr-only" htmlFor="search">
                    搜索接口
                  </label>
                  <div className="search-box">
                    <span>⌕</span>
                    <input
                      id="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索方法、路径、名称"
                    />
                  </div>
                  <div className="operation-list">
                    {[...groups].map(([name, ops]) => (
                      <details open key={name}>
                        <summary>
                          <span>⌄</span> {name} <small>{ops.length}</small>
                        </summary>
                        {ops.map((o) => (
                          <button
                            type="button"
                            key={o.id}
                            onClick={() => {
                              setSelected(o.id);
                              setPreview("usage");
                            }}
                            className={selected === o.id ? "selected" : ""}
                            aria-pressed={selected === o.id}
                          >
                            <span
                              className={
                                "method mini " + o.method.toLowerCase()
                              }
                            >
                              {o.method}
                            </span>
                            <span>{o.name}</span>
                            {o.deprecated && <em title="已废弃">↯</em>}
                          </button>
                        ))}
                      </details>
                    ))}
                    {!filtered.length && (
                      <p className="no-results">没有匹配的接口。</p>
                    )}
                  </div>
                </aside>
                <section className="preview-panel" aria-label="生成结果预览">
                  <div className="file-tabs" role="group" aria-label="预览文件">
                    {(
                      [
                        "usage",
                        "types.ts",
                        "client.ts",
                        ...(settings.hooks ? ["react.ts"] : []),
                        "runtime.ts",
                        "diagnostics",
                      ] as Preview[]
                    ).map((file) => (
                      <button
                        type="button"
                        key={file}
                        aria-pressed={preview === file}
                        className={preview === file ? "active" : ""}
                        onClick={() => setPreview(file)}
                      >
                        {file === "usage"
                          ? "调用示例"
                          : file === "diagnostics"
                            ? "诊断报告"
                            : file}
                      </button>
                    ))}
                  </div>
                  {preview === "usage" && op && (
                    <div className="operation-title">
                      <div>
                        <span className={"method " + op.method.toLowerCase()}>
                          {op.method}
                        </span>
                        <code>{op.path}</code>
                        <span>{op.deprecated ? "已废弃" : op.summary}</span>
                      </div>
                      {settings.hooks && (
                        <div
                          className="mode-switch"
                          role="group"
                          aria-label="调用方式"
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
                    </div>
                  )}
                  <div className="code-heading">
                    <span>
                      <i />
                      <i />
                      <i />
                    </span>
                    <small>
                      {preview === "usage"
                        ? "example.ts"
                        : preview === "diagnostics"
                          ? "diagnostics.json"
                          : preview}
                    </small>
                    <span>TYPESCRIPT · UTF-8</span>
                  </div>
                  {preview === "diagnostics" ? (
                    <div className="diagnostic-list">
                      {result.diagnostics.slice(0, 120).map((d, i) => (
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
                      {result.diagnostics.length > 120 && (
                        <p>显示前120条，完整报告在manifest.json中。</p>
                      )}
                    </div>
                  ) : (
                    <Code text={code} />
                  )}
                  <div className="preview-actions">
                    <span>
                      {preview === "usage"
                        ? "示例参数需按生成类型补全；不发送请求"
                        : preview === "diagnostics"
                          ? "文档缺漏与生成取舍均会记录"
                          : "完整源码包含在下载的 SDK 中"}
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={!ready}
                        onClick={() => {
                          if (ready)
                            download(
                              code,
                              preview === "usage"
                                ? "example.ts"
                                : preview === "diagnostics"
                                  ? "diagnostics.json"
                                  : preview,
                            );
                        }}
                      >
                        下载当前
                      </button>
                      <button
                        type="button"
                        className="copy"
                        disabled={!ready}
                        onClick={() => void copy()}
                      >
                        复制代码 ↗
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
          {!result && !busy && (
            <div className="empty">
              <span>{`{ ↳ }`}</span>
              <h3>
                {error
                  ? "修正文档或配置后，重新生成"
                  : "你的 SDK，从一份 JSON 开始。"}
              </h3>
              <p>粘贴 OpenAPI JSON，或载入合成示例体验。</p>
            </div>
          )}
        </section>
        <section id="guide" className="guide">
          <div className="guide-heading">
            <span className="eyebrow">BUILT FOR YOUR WORKFLOW</span>
            <h2>类型、请求、缓存，各就各位。</h2>
            <p>下载的是能放进工程里的 TypeScript 源码。</p>
          </div>
          <div className="guide-grid">
            <article>
              <span className="guide-number">01 / TYPE</span>
              <h3>接口变了，编辑器先知道。</h3>
              <p>
                模型与请求参数分开生成。缺失的响应模型明确标为 unknown，readOnly
                与 writeOnly 按方向处理。
              </p>
              <code>Promise&lt;OutputSchemas['User']&gt;</code>
            </article>
            <article>
              <span className="guide-number">02 / EXTEND</span>
              <h3>继续用你熟悉的请求层。</h3>
              <p>
                替换请求适配器，串联异步前置、后置与错误处理。认证、日志和响应处理由你的业务决定。
              </p>
              <code>beforeRequest → request → afterResponse</code>
            </article>
            <article>
              <span className="guide-number">03 / REACT</span>
              <h3>读取有缓存，写入要触发。</h3>
              <p>
                GET / HEAD 接入 useSWR；其他方法接入
                useSWRMutation。切换身份时，更新 cacheScope。
              </p>
              <code>
                const {"{ trigger }"} = API.…useRequest(params, body, options)
              </code>
            </article>
          </div>
        </section>
        <details className="limits">
          <summary>
            支持范围与需要留意的边界 <span>＋</span>
          </summary>
          <div>
            <p>
              支持Swagger 2.0、OpenAPI 3.0 / 3.1 JSON，本地
              $ref、常见Schema类型、组合类型、枚举、参数与JSON/平面表单。只导入JSON，不读取Swagger
              UI网页HTML，不自动抓取外部引用。
            </p>
            <p>
              类型不等于运行时验证；不保证覆盖全部JSON
              Schema约束。多媒体类型会选择并提示，缺少模型使用unknown。鉴权方案不会自动转为真实凭据。生成器不发送业务请求；下载后的SDK只有被业务调用时才发送请求。
            </p>
            <p>
              仅保存主题；文档和结果保留在本页内存。清空可移除当前文档与生成结果。SWR入口必须遵循React
              Hooks规则。更多边界与自定义适配器示例见下载包README。
            </p>
          </div>
        </details>
        <footer className="footer">
          <a href="#top" className="footer-brand">
            ChainSpec <span>契约清楚，调用顺手。</span>
          </a>
          <div>
            <span>React + Vite · MIT</span>
            <a
              href="https://github.com/batype/chainspec"
              target="_blank"
              rel="noreferrer"
            >
              开源代码 ↗
            </a>
          </div>
        </footer>
      </main>
    </>
  );
}

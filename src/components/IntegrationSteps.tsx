import { useState, useEffect } from "react";
import type { GeneratedProject, Operation, SDKTarget } from "../core/model";
import { SDK_TARGETS } from "../core/targets";
import { usage, type UsageEnvironment } from "../usage";
import Code from "./Code";
function CopyCode({ title, text }: { title: string; text: string }) {
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [text]);
  return (
    <div className="setup-code">
      <div>
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`复制${title}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setNotice("已复制");
            } catch {
              setNotice("复制失败，请手动选择代码");
            }
          }}
        >
          复制
        </button>
      </div>
      <Code text={text} limit={140} />
      <span role="status">{notice}</span>
    </div>
  );
}
const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
export default function IntegrationSteps({
  project,
  op,
  document,
  target,
  output,
  source,
  ready,
  demo,
  onDownload,
  onConfig,
}: {
  project: GeneratedProject;
  op: Operation;
  document: unknown;
  target: SDKTarget;
  output: string;
  source: string;
  ready: boolean;
  demo: boolean;
  onDownload: () => void;
  onConfig: () => void;
}) {
  const [mode, setMode] = useState<"download" | "cli">("download");
  const react = Boolean(project.files["react.ts"]);
  const label = SDK_TARGETS.find((item) => item.value === target)!.label;
  const dir =
    output.trim().replace(/\\/g, "/").replace(/\/$/, "") || "./src/api";
  const relative = !dir.startsWith("/") && !/^[A-Za-z]:/.test(dir);
  const sdk = relative ? (dir.startsWith(".") ? dir : `./${dir}`) : "./sdk";
  const config = project.files["tsconfig.json"]
    ? "tsconfig.json"
    : react
      ? "tsconfig.react.json"
      : "tsconfig.node.json";
  const needsBuild = target === "node" || target === "next" || target === "all";
  const environment: UsageEnvironment =
    target === "react"
      ? "react"
      : target === "browser"
        ? "universal"
        : target === "next"
          ? "next-server"
          : target === "vite-ssr"
            ? "vite-ssr"
            : "node";
  // Node uses compiled JS too; Vite can consume the source entries directly.
  const example = usage(
    project,
    op,
    "request",
    environment,
    document,
    needsBuild && target !== "next" ? `${sdk}/dist` : sdk,
    true,
  );
  const javascript =
    (target === "node" || target === "all") && !example.includes("import type");
  const firstCode =
    javascript && example.includes("const data = await")
      ? example + "\nconsole.log(data);\n"
      : example;
  const deps = react
    ? "npm install swr\n# 应用中缺少 TypeScript / React 类型时再安装：\nnpm install -D typescript @types/react"
    : "npm install -D typescript";
  return (
    <section className="integration-steps" aria-label="当前项目接入步骤">
      <div className="setup-heading">
        <div>
          <span>从生成到第一次调用</span>
          <h2>接入你的 {label} 项目</h2>
          <p>
            以下使用当前文档的 {op.id}，输出目录为 <code>{dir}</code>。
          </p>
        </div>
        <div className="mode-switch" role="group" aria-label="接入方式">
          <button
            type="button"
            aria-pressed={mode === "download"}
            onClick={() => setMode("download")}
          >
            下载接入
          </button>
          <button
            type="button"
            aria-pressed={mode === "cli"}
            onClick={() => setMode("cli")}
          >
            CLI 持续生成
          </button>
        </div>
      </div>
      {demo && (
        <p className="setup-note">
          当前是演示文档生成的 SDK；用于自己的业务前，请先导入你的接口文档。
        </p>
      )}
      <div className="setup-step">
        <span>01</span>
        <div>
          <h3>{mode === "download" ? "放入 SDK 源码" : "保存配置并生成"}</h3>
          {mode === "download" ? (
            <>
              <p>
                下载对应 ZIP，将其中的 <code>sdk</code> 文件夹移动到项目的{" "}
                <code>{dir}</code>。自定义业务代码放在此目录之外。
              </p>
              <button type="button" disabled={!ready} onClick={onDownload}>
                下载 {label} SDK ZIP
              </button>
            </>
          ) : (
            <>
              <p>
                将导出的配置保存为项目根目录的{" "}
                <code>chainspec.config.json</code>，并准备文档{" "}
                <code>{source}</code>。凭据按配置中的环境变量引用填写。
              </p>
              <button type="button" disabled={!ready} onClick={onConfig}>
                下载当前生成配置
              </button>
              <CopyCode
                title="生成 SDK 命令"
                text="npm install -D @batype/chainspec@^3.3.0\nnpx chainspec --config chainspec.config.json"
              />
              <p>
                首次生成需要新目录；网页解压目录请另选输出位置。之后执行{" "}
                <code>
                  npx chainspec --config chainspec.config.json --update
                </code>{" "}
                更新。
              </p>
            </>
          )}
        </div>
      </div>
      <div className="setup-step">
        <span>02</span>
        <div>
          <h3>准备依赖{needsBuild ? "并构建 SDK" : ""}</h3>
          <p>
            {react
              ? "已有 React 应用无需重装 React，SWR 依赖用于 Hooks。"
              : "仅使用 request，不依赖 React / SWR。"}
            已有对应依赖时可跳过安装。
          </p>
          <CopyCode title="安装依赖（应用根目录）" text={deps} />
          {needsBuild ? (
            <>
              <CopyCode
                title="构建 SDK（sh / zsh）"
                text={`npx tsc -p ${quote(`${dir}/${config}`)}`}
              />
              <p>
                构建生成 <code>dist</code>。CLI
                更新保留这个目录，更新源码后再运行相同构建命令。
              </p>
            </>
          ) : (
            <p>Vite 直接处理 TypeScript 源码，无需单独构建 SDK。</p>
          )}
        </div>
      </div>
      <div className="setup-step">
        <span>03</span>
        <div>
          <h3>复制首次调用代码</h3>
          <p>
            以下示例文件放在项目根目录，导入路径与上面的 SDK
            目录对应。用真实业务地址替换示例地址；示例不会在本页执行。
          </p>
          {!relative && (
            <p className="setup-note">
              当前输出为绝对路径；下方以 ./sdk
              为示意，请按项目位置调整导入路径。
            </p>
          )}
          <CopyCode
            title={
              javascript
                ? "api-example.mjs（项目根目录）"
                : target === "react"
                  ? "api-example.tsx（项目根目录）"
                  : "api-example.ts（项目根目录）"
            }
            text={firstCode}
          />
          <p>
            {javascript
              ? "Node 可在替换业务地址后运行 node api-example.mjs；"
              : "TypeScript 业务文件需由应用编译；"}
            Next.js 客户端组件及 SSR 首屏数据接管见{" "}
            <a href={`#/guide?section=integration&target=${target}`}>
              对应接入指南 →
            </a>
            。
          </p>
        </div>
      </div>
      <p className="setup-footer">
        SDK
        类型用于编译检查，示例值需按业务调整；Headers、认证与请求适配器由应用配置。完整源码、交互体验和诊断仍可从上方标签查看。
      </p>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { SWRConfig } from "swr";
import {
  createClient,
  type Input,
  type RequestContext,
} from "../../templates/runtime";
import { withQuery } from "../../templates/hooks";
import type { GeneratedProject, Operation } from "../core/model";
import { operationSample, parsePlayground } from "../playground";
import Code from "./Code";

type Props = {
  project: GeneratedProject;
  op: Operation;
  document: unknown;
  hooks: boolean;
};
const pretty = (value: unknown) =>
  JSON.stringify(value, null, 2) ?? "// 无响应体";
export default function Playground(props: Props) {
  const cache = useMemo(
    () => ({
      provider: () => new Map(),
      dedupingInterval: 0,
      shouldRetryOnError: false,
    }),
    [],
  );
  return (
    <SWRConfig value={cache}>
      <Session {...props} />
    </SWRConfig>
  );
}
function Session({ project, op, document, hooks }: Props) {
  const initial = useMemo(() => operationSample(op, document), [op, document]);
  const [params, setParams] = useState(pretty(initial.params)),
    [body, setBody] = useState(pretty(initial.body)),
    [headers, setHeaders] = useState(pretty(initial.headers));
  const [bound, setBound] = useState({
    params: initial.params,
    body: initial.body,
    headers: initial.headers,
  });
  const [mode, setMode] = useState<"request" | "hook">("request"),
    [enabled, setEnabled] = useState(true);
  const [invalid, setInvalid] = useState(""),
    [events, setEvents] = useState<string[]>([]),
    [count, setCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<unknown>(),
    [data, setData] = useState<unknown>(),
    [requestError, setRequestError] = useState(""),
    [pending, setPending] = useState(false);
  const [fail, setFail] = useState(false),
    failure = useRef(fail),
    alive = useRef(true);
  failure.current = fail;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const endpoint = useMemo(() => {
    const log = (text: string) => {
      if (alive.current) setEvents((list) => [...list.slice(-11), text]);
    };
    const client = createClient({
      baseUrl: project.baseUrl,
      cacheScope: "local-playground",
      beforeRequest: [
        (ctx) => {
          log("beforeRequest · 请求参数已准备");
          return ctx;
        },
      ],
      request: async (ctx: RequestContext) => {
        const shouldFail = failure.current;
        if (alive.current) {
          setCount((value) => value + 1);
          setLastRequest({
            method: ctx.method,
            url: ctx.url,
            headers: Object.fromEntries(ctx.headers),
            ...(ctx.body !== undefined ? { body: ctx.body } : {}),
          });
        }
        log("request · 本地模拟适配器（未发送 HTTP）");
        await new Promise((resolve) => setTimeout(resolve, 350));
        return {
          status: shouldFail
            ? 500
            : Number(
                op.responseStatuses.find((status) => /^2\d\d$/.test(status)) ??
                  200,
              ),
          data: shouldFail
            ? { message: "模拟服务暂时不可用，请关闭错误模拟后重试" }
            : initial.response,
          headers: new Headers(),
        };
      },
      afterResponse: [
        (response) => {
          log(`afterResponse · ${response.status} · 返回模拟数据`);
          return response;
        },
      ],
      onError: [
        (error) => {
          log(
            `onError · ${error instanceof Error ? error.message : "请求失败"}`,
          );
        },
      ],
    });
    return withQuery(
      client.endpoint<Input, unknown, unknown, true, false>({
        ...op,
        hasBody: Boolean(op.body),
        bodyRequired: op.body?.required,
        mediaType: op.body?.mediaType,
      }),
    );
  }, [op, project.baseUrl, initial]);
  const options = useMemo(
    () => ({
      headers: bound.headers,
      enabled,
      swr: {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: false,
      },
    }),
    [bound.headers, enabled],
  );
  // The signature is dynamic, but the actual argument positions match the generated contract.
  const args = op.body
    ? [mode === "hook" ? bound.params : null, bound.body, options]
    : [mode === "hook" ? bound.params : null, options];
  const hook = (
    endpoint.useRequest as (
      ...args: unknown[]
    ) => ReturnType<typeof endpoint.useRequest>
  )(...args);
  const running =
    pending || hook.isLoading || hook.isMutating || hook.isValidating;
  const currentError = mode === "hook" ? hook.error?.message : requestError;
  const currentData = mode === "hook" ? hook.data : data;
  const changed =
    params !== pretty(bound.params) ||
    body !== pretty(bound.body) ||
    headers !== pretty(bound.headers);
  function apply() {
    try {
      const next = parsePlayground(params, body, headers, Boolean(op.body));
      setBound(next);
      setParams(pretty(next.params));
      setBody(pretty(next.body));
      setHeaders(pretty(next.headers));
      setInvalid("");
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : "JSON 格式不正确");
    }
  }
  async function run(action: "request" | "trigger" | "refresh") {
    setRequestError("");
    if (action === "request") setPending(true);
    try {
      if (action === "request") {
        const callArgs = op.body
          ? [bound.params, bound.body, { headers: bound.headers }]
          : [bound.params, { headers: bound.headers }];
        const value = await (
          endpoint.request as (...args: unknown[]) => Promise<unknown>
        )(...callArgs);
        if (alive.current) setData(value);
      } else if (action === "trigger") await hook.trigger();
      else await hook.refresh();
    } catch (error) {
      if (alive.current)
        setRequestError(error instanceof Error ? error.message : "请求失败");
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const call = `API.${project.namespace}.${op.controller}.${op.name}`;
  const values = [
    pretty(bound.params),
    ...(op.body ? [pretty(bound.body)] : []),
    pretty({ headers: bound.headers, ...(mode === "hook" ? { enabled } : {}) }),
  ];
  const code =
    mode === "request"
      ? `const data = await ${call}.request(\n${values.join(",\n")}\n);`
      : `const { data, error, isLoading, trigger, refresh } =\n  ${call}.useRequest(\n${values.join(",\n")}\n);\n\n// 事件或自定义 Hook 回调中重新请求\nconst onSubmit = () => trigger();\nconst onRefresh = () => refresh();`;
  return (
    <div className="playground">
      <div className="sandbox-banner">
        <span className="sandbox-dot" /> 本地体验{" "}
        <span>
          运行 SDK 共用的请求层与 SWR Hook，响应由 Schema 合成，不调用业务接口。
        </span>
      </div>
      <div className="play-controls">
        <div role="group" aria-label="体验调用方式" className="play-mode">
          <button
            type="button"
            aria-pressed={mode === "request"}
            disabled={running}
            onClick={() => setMode("request")}
          >
            Promise · request
          </button>
          {hooks && (
            <button
              type="button"
              aria-pressed={mode === "hook"}
              disabled={running}
              onClick={() => setMode("hook")}
            >
              React · useRequest
            </button>
          )}
        </div>
        {mode === "hook" && (
          <label>
            <input
              type="checkbox"
              checked={enabled}
              disabled={running}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            自动请求
          </label>
        )}
        <label className="simulate-error">
          <input
            type="checkbox"
            checked={fail}
            disabled={running}
            onChange={(e) => setFail(e.target.checked)}
          />{" "}
          模拟错误
        </label>
      </div>
      <div className="play-grid">
        <section className="play-inputs" aria-labelledby="play-input-heading">
          <div className="play-section-heading">
            <h3 id="play-input-heading">01 / 传入参数</h3>
            <button
              type="button"
              onClick={apply}
              disabled={running || !changed}
            >
              应用参数
            </button>
          </div>
          <p className="play-help">
            示例值来自接口类型，可编辑后应用。复杂 Schema 可能需要手动补全。
          </p>
          <label htmlFor="play-params">
            params <span>path / query / cookies</span>
          </label>
          <textarea
            id="play-params"
            name="params"
            spellCheck={false}
            value={params}
            onChange={(e) => setParams(e.target.value)}
          />
          {op.body && (
            <>
              <label htmlFor="play-body">
                body <span>{op.body.mediaType}</span>
              </label>
              <textarea
                id="play-body"
                name="body"
                spellCheck={false}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </>
          )}
          <details>
            <summary>
              headers <span>位于 options 中</span>
            </summary>
            <label className="sr-only" htmlFor="play-headers">
              请求头 JSON
            </label>
            <textarea
              id="play-headers"
              spellCheck={false}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
            />
          </details>
          {invalid && (
            <p className="play-error" role="alert">
              {invalid}
            </p>
          )}
          {changed && (
            <p className="play-help" role="status">
              参数尚未应用；运行使用上一次应用的值。
            </p>
          )}
          <div className="play-run-actions">
            {mode === "request" ? (
              <button
                type="button"
                className="primary"
                disabled={running || changed}
                onClick={() => void run("request")}
              >
                {running ? "正在运行…" : "▶ 运行 request"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={running || changed}
                  onClick={() => void run("trigger")}
                >
                  trigger()
                </button>
                <button
                  type="button"
                  disabled={running || changed}
                  onClick={() => void run("refresh")}
                >
                  ↻ refresh()
                </button>
              </>
            )}
          </div>
          <p className="play-help">
            {mode === "request"
              ? "点击运行，观察请求如何组装。"
              : enabled
                ? "挂载和应用新参数时自动请求，也可以手动重新请求。"
                : "enabled: false · 等待 trigger() 或 refresh()。"}
          </p>
        </section>
        <section className="play-output" aria-labelledby="play-output-heading">
          <div className="play-section-heading">
            <h3 id="play-output-heading">02 / 调用与结果</h3>
            <span className="run-count" role="status">
              {running ? "运行中…" : `已请求 ${count} 次`}
            </span>
          </div>
          <div className="play-code">
            <Code text={code} limit={80} />
          </div>
          <div className="response-heading">
            <strong>响应预览</strong>
            <span>
              {currentError
                ? "ERROR"
                : count && !running
                  ? "本地模拟响应"
                  : "等待调用"}
            </span>
          </div>
          <div className="mock-response" aria-live="polite">
            {currentError ? (
              <p className="play-error">{currentError}</p>
            ) : (
              <pre tabIndex={0}>
                {running
                  ? "// 正在执行本地模拟请求…"
                  : count
                    ? pretty(currentData)
                    : "// 运行后在这里查看返回数据"}
              </pre>
            )}
          </div>
          <details className="request-details">
            <summary>查看实际组装的请求</summary>
            <pre tabIndex={0}>
              {lastRequest
                ? pretty(lastRequest)
                : "// 运行后显示 method、URL、headers 与 body"}
            </pre>
          </details>
          <div className="execution-log">
            <strong>
              执行过程 <span>最近 12 个事件</span>
            </strong>
            <ol aria-live="polite">
              {events.map((event, i) => (
                <li key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {event}
                </li>
              ))}
            </ol>
            {!events.length && <p>beforeRequest → request → afterResponse</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

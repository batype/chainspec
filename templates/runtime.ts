/** ChainSpec runtime. Generated SDK types describe the spec, not runtime validation. */
export type Parameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  style?: string;
  explode?: boolean;
};
export type Definition = {
  id: string;
  method: string;
  path: string;
  controller: string;
  name: string;
  parameters: Parameter[];
  bodyRequired?: boolean;
  mediaType?: string;
  responseType: "json" | "text" | "blob" | "void" | "auto";
};
export type Input = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  cookies?: Record<string, unknown>;
  body?: unknown;
};
export interface RequestContext {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  mediaType?: string;
  signal?: AbortSignal;
  readonly operation: Definition;
}
export interface TransportResponse {
  data: unknown;
  status: number;
  headers: Headers;
}
export type RequestAdapter = (
  context: RequestContext,
) => Promise<TransportResponse>;
export type BeforeRequest = (
  context: RequestContext,
) => void | RequestContext | Promise<void | RequestContext>;
export type AfterResponse = (
  response: TransportResponse,
  context: RequestContext,
) => void | TransportResponse | Promise<void | TransportResponse>;
export type OnError = (
  error: unknown,
  context: RequestContext | undefined,
) => void | Promise<void>;
export interface RequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
  beforeRequest?: BeforeRequest[];
  afterResponse?: AfterResponse[];
  onError?: OnError[];
}
export interface ClientConfig {
  baseUrl?: string;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  request?: RequestAdapter;
  beforeRequest?: BeforeRequest[];
  afterResponse?: AfterResponse[];
  onError?: OnError[];
  /** Change on tenant/user/auth changes. Never put bearer tokens here. */ cacheScope?:
    | string
    | (() => string);
}
export type RequestArgs<I> = {} extends I
  ? [input?: I, options?: RequestOptions]
  : [input: I, options?: RequestOptions];
export interface Endpoint<I, R> {
  readonly definition: Definition;
  request(...args: RequestArgs<I>): Promise<R>;
  getKey(input?: I, options?: RequestOptions): readonly unknown[];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown,
    public headers: Headers,
  ) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
  }
}
const scalar = (value: unknown): string => {
  if (value === null) return "";
  if (["string", "number", "boolean"].includes(typeof value))
    return String(value);
  throw new Error("Parameter must be a scalar or a declared array/object");
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function queryEntries(
  name: string,
  value: unknown,
  style = "form",
  explode = true,
): [string, string][] {
  if (value === undefined) return [];
  if (style === "deepObject") {
    if (!isRecord(value)) throw new Error("deepObject needs an object");
    return Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [`${name}[${k}]`, scalar(v)]);
  }
  if (Array.isArray(value)) {
    if (style === "form" && explode) return value.map((v) => [name, scalar(v)]);
    const delimiter =
      style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    return [[name, value.map(scalar).join(delimiter)]];
  }
  if (isRecord(value)) {
    const values = Object.entries(value).filter(([, v]) => v !== undefined);
    return explode
      ? values.map(([k, v]) => [k, scalar(v)])
      : [[name, values.flatMap(([k, v]) => [k, scalar(v)]).join(",")]];
  }
  return [[name, scalar(value)]];
}
function pathValue(value: unknown, explode = false): string {
  const enc = (v: unknown) => encodeURIComponent(scalar(v));
  if (Array.isArray(value)) return value.map(enc).join(",");
  if (isRecord(value))
    return Object.entries(value)
      .map(([k, v]) =>
        explode ? `${enc(k)}=${enc(v)}` : `${enc(k)},${enc(v)}`,
      )
      .join(",");
  return enc(value);
}
export async function defaultRequest(
  ctx: RequestContext,
): Promise<TransportResponse> {
  const headers = new Headers(ctx.headers);
  let body: BodyInit | undefined;
  if (ctx.body !== undefined) {
    if (ctx.method === "GET" || ctx.method === "HEAD")
      throw new Error(
        "Fetch cannot send GET/HEAD bodies; configure a request adapter",
      );
    if (ctx.mediaType?.includes("json")) {
      body = JSON.stringify(ctx.body);
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", ctx.mediaType);
    } else if (ctx.mediaType?.startsWith("multipart/form-data")) {
      if (!isRecord(ctx.body))
        throw new Error("Multipart body must be an object");
      const form = new FormData();
      for (const [name, value] of Object.entries(ctx.body)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value])
          form.append(name, v instanceof Blob ? v : scalar(v));
      }
      body = form;
      headers.delete("Content-Type");
    } else if (ctx.mediaType?.startsWith("application/x-www-form-urlencoded")) {
      if (!isRecord(ctx.body)) throw new Error("Form body must be an object");
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(ctx.body))
        for (const [k, v] of queryEntries(name, value)) form.append(k, v);
      body = form.toString();
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", ctx.mediaType);
    } else if (
      typeof ctx.body === "string" ||
      ctx.body instanceof Blob ||
      ctx.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(ctx.body)
    ) {
      body = ctx.body as BodyInit;
      if (ctx.mediaType && !headers.has("Content-Type"))
        headers.set("Content-Type", ctx.mediaType);
    } else
      throw new Error("Unsupported body format; configure a request adapter");
  }
  const response = await fetch(ctx.url, {
    method: ctx.method,
    headers,
    body,
    signal: ctx.signal,
  });
  let data: unknown;
  const mode = ctx.operation.responseType;
  if (
    response.status === 204 ||
    response.status === 205 ||
    ctx.method === "HEAD"
  )
    data = undefined;
  else if (!response.ok) {
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else if (mode === "void") data = undefined;
  else if (
    mode === "blob" ||
    (mode === "auto" &&
      !response.headers.get("Content-Type")?.includes("json") &&
      !response.headers.get("Content-Type")?.startsWith("text/"))
  )
    data = await response.blob();
  else {
    const text = await response.text();
    data =
      mode === "json" ||
      (mode === "auto" &&
        response.headers.get("Content-Type")?.includes("json"))
        ? text
          ? JSON.parse(text)
          : undefined
        : text;
  }
  return { data, status: response.status, headers: response.headers };
}
const runtimeId = Math.random().toString(36).slice(2);
let nextClient = 0;
export function createClient(config: ClientConfig = {}) {
  const clientId = `chainspec-${runtimeId}-${++nextClient}`;
  const base = config.baseUrl ?? "";
  const before = [...(config.beforeRequest ?? [])],
    after = [...(config.afterResponse ?? [])],
    errors = [...(config.onError ?? [])];
  return {
    endpoint<I, R>(definition: Definition): Endpoint<I, R> {
      const def = Object.freeze({
        ...definition,
        parameters: definition.parameters.map((p) => Object.freeze({ ...p })),
      });
      async function execute(
        input: Input = {},
        options: RequestOptions = {},
      ): Promise<R> {
        let context: RequestContext | undefined;
        try {
          let path = def.path;
          for (const p of def.parameters.filter((p) => p.in === "path")) {
            const value = input.path?.[p.name];
            if (value === undefined || value === null)
              throw new Error(`Missing path parameter: ${p.name}`);
            path = path.split(`{${p.name}}`).join(pathValue(value, p.explode));
          }
          if (/\{[^}]+\}/.test(path))
            throw new Error("Unresolved path parameter");
          const query = new URLSearchParams();
          const headers = new Headers(
            typeof config.headers === "function"
              ? await config.headers()
              : config.headers,
          );
          new Headers(options.headers).forEach((v, k) => headers.set(k, v));
          for (const p of def.parameters.filter((p) => p.in !== "path")) {
            const bag =
              p.in === "query"
                ? input.query
                : p.in === "header"
                  ? input.headers
                  : input.cookies;
            const value = bag?.[p.name];
            if (p.required && (value === undefined || value === null))
              throw new Error(`Missing ${p.in} parameter: ${p.name}`);
            if (value === undefined) continue;
            if (p.in === "query")
              for (const [k, v] of queryEntries(
                p.name,
                value,
                p.style,
                p.explode ?? true,
              ))
                query.append(k, v);
            else if (p.in === "header")
              headers.set(
                p.name,
                Array.isArray(value)
                  ? value.map(scalar).join(",")
                  : scalar(value),
              );
            else if (config.request)
              headers.append(
                "Cookie",
                `${p.name}=${encodeURIComponent(scalar(value))}`,
              );
            else
              throw new Error(
                "Cookie parameters require a custom Node request adapter; browser Fetch cannot set Cookie headers",
              );
          }
          if (def.bodyRequired && input.body === undefined)
            throw new Error("Request body is required");
          const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}${query.size ? `?${query}` : ""}`;
          context = {
            url,
            method: def.method,
            headers,
            body: input.body,
            mediaType: def.mediaType,
            signal: options.signal,
            operation: def,
          };
          for (const fn of [...before, ...(options.beforeRequest ?? [])])
            context = (await fn(context)) ?? context;
          let response = await (config.request ?? defaultRequest)(context);
          if (
            !Number.isInteger(response.status) ||
            response.status < 100 ||
            response.status > 599
          )
            throw new Error("Adapter must return {data,status,headers}");
          if (response.status < 200 || response.status >= 300)
            throw new ApiError(
              response.status,
              response.data,
              response.headers,
            );
          for (const fn of [...after, ...(options.afterResponse ?? [])])
            response = (await fn(response, context)) ?? response;
          return response.data as R;
        } catch (error) {
          for (const fn of [...errors, ...(options.onError ?? [])])
            await fn(error, context);
          throw error;
        }
      }
      return {
        definition: def,
        request: execute as Endpoint<I, R>["request"],
        getKey(input?: I, options?: RequestOptions) {
          const scope =
            typeof config.cacheScope === "function"
              ? config.cacheScope()
              : (config.cacheScope ?? "");
          return [
            clientId,
            base,
            scope,
            def.id,
            input ?? {},
            Array.from(new Headers(options?.headers).entries()),
          ];
        },
      };
    },
  };
}

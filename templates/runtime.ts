/** ChainSpec runtime. Generated SDK types describe the spec, not runtime validation. */
/** Use the host Fetch types, including Node's undici types without DOM globals. */
export type HeadersInit = NonNullable<NonNullable<Parameters<typeof globalThis.fetch>[1]>["headers"]>;
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
  hasBody: boolean;
  bodyRequired?: boolean;
  mediaType?: string;
  responseType: "json" | "text" | "blob" | "void" | "auto";
};
export type Input = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  cookies?: Record<string, unknown>;
};
export interface RequestContext {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  mediaType?: string;
  signal?: AbortSignal;
  /** Optional Fetch implementation, supplied by the client configuration. */
  fetch?: typeof globalThis.fetch;
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
  /** Replace Fetch while retaining serialization, response parsing and interceptors. */
  fetch?: typeof globalThis.fetch;
  beforeRequest?: BeforeRequest[];
  afterResponse?: AfterResponse[];
  onError?: OnError[];
  /** Change on tenant/user/auth changes. Never put bearer tokens here. */ cacheScope?:
    | string
    | (() => string);
}
export type RequestArgs<
  P,
  B,
  H extends boolean,
  Required extends boolean,
> = H extends true
  ? Required extends true
    ? [params: P, body: B, options?: RequestOptions]
    : [params: P, body?: B, options?: RequestOptions]
  : {} extends P
    ? [params?: P, options?: RequestOptions]
    : [params: P, options?: RequestOptions];
export interface Endpoint<
  P,
  B,
  R,
  H extends boolean = false,
  Required extends boolean = false,
> {
  readonly definition: Definition;
  request(...args: RequestArgs<P, B, H, Required>): Promise<R>;
  getKey(...args: RequestArgs<P, B, H, Required>): readonly unknown[];
}
/** Body position is fixed by the generated operation contract, never inferred from object keys. */
export function splitArgs(
  definition: Definition,
  args: readonly unknown[],
): { params: Input; body: unknown; options: RequestOptions } {
  return {
    params: (args[0] ?? {}) as Input,
    body: definition.hasBody ? args[1] : undefined,
    options: (args[definition.hasBody ? 2 : 1] ?? {}) as RequestOptions,
  };
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
  const response = await (ctx.fetch ?? globalThis.fetch)(ctx.url, {
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
    endpoint<P, B, R, H extends boolean, Required extends boolean>(
      definition: Definition,
    ): Endpoint<P, B, R, H, Required> {
      const def = Object.freeze({
        ...definition,
        parameters: definition.parameters.map((p) => Object.freeze({ ...p })),
      });
      async function execute(...args: unknown[]): Promise<R> {
        const { params: input, body, options } = splitArgs(def, args);
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
          for (const p of def.parameters.filter(
            (p) => p.in === "query" || p.in === "cookie",
          )) {
            const bag = p.in === "query" ? input.query : input.cookies;
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
          if (def.bodyRequired && body === undefined)
            throw new Error("Request body is required");
          const url = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}${query.size ? `?${query}` : ""}`;
          context = {
            url,
            method: def.method,
            headers,
            body,
            mediaType: def.mediaType,
            signal: options.signal,
            fetch: config.fetch,
            operation: def,
          };
          for (const fn of [...before, ...(options.beforeRequest ?? [])])
            context = (await fn(context)) ?? context;
          for (const p of def.parameters.filter(
            (p) => p.in === "header" && p.required,
          )) {
            if (!context.headers.has(p.name))
              throw new Error(`Missing header parameter: ${p.name}`);
          }
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
        request: execute as Endpoint<P, B, R, H, Required>["request"],
        getKey(...args: RequestArgs<P, B, H, Required>) {
          const { params, body, options } = splitArgs(def, args);
          const scope =
            typeof config.cacheScope === "function"
              ? config.cacheScope()
              : (config.cacheScope ?? "");
          return [
            clientId,
            base,
            scope,
            def.id,
            params,
            body,
            Array.from(new Headers(options?.headers).entries()),
          ];
        },
      };
    },
  };
}

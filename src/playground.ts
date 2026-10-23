import type { Operation } from "./core/model.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Bounded, local-only schema examples. These are samples, never schema validation. */
export function schemaSample(
  schema: unknown,
  document: unknown,
  direction: "input" | "output" = "input",
): unknown {
  let budget = 100;
  function sample(value: unknown, depth: number, seen: Set<string>): unknown {
    if (--budget < 0 || depth > 6 || !record(value)) return null;
    if (typeof value.$ref === "string") {
      if (!value.$ref.startsWith("#/") || seen.has(value.$ref)) return null;
      let target: unknown = document;
      for (const part of value.$ref.slice(2).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        target =
          record(target) && Object.hasOwn(target, key)
            ? target[key]
            : undefined;
      }
      return sample(target, depth + 1, new Set([...seen, value.$ref]));
    }
    if (Object.hasOwn(value, "example")) return value.example;
    if (Object.hasOwn(value, "default")) return value.default;
    if (Array.isArray(value.enum) && value.enum.length) return value.enum[0];
    if (Array.isArray(value.allOf)) {
      const pieces = value.allOf
        .slice(0, 12)
        .map((item) => sample(item, depth + 1, seen));
      return Object.fromEntries(pieces.filter(record).flatMap(Object.entries));
    }
    const choices = value.oneOf ?? value.anyOf;
    if (Array.isArray(choices)) return sample(choices[0], depth + 1, seen);
    if (value.type === "array") return [sample(value.items, depth + 1, seen)];
    if (value.type === "object" || record(value.properties)) {
      return Object.fromEntries(
        Object.entries(record(value.properties) ? value.properties : {})
          .slice(0, 12)
          .filter(
            ([, s]) =>
              !record(s) || !(direction === "input" ? s.readOnly : s.writeOnly),
          )
          .map(([key, s]) => [key, sample(s, depth + 1, seen)]),
      );
    }
    if (value.type === "integer" || value.type === "number")
      return typeof value.minimum === "number" ? value.minimum : 1;
    if (value.type === "boolean") return true;
    if (value.type === "string")
      return value.format === "email"
        ? "hello@example.com"
        : value.format === "date"
          ? "2026-01-01"
          : value.format === "date-time"
            ? "2026-01-01T00:00:00Z"
            : "demo";
    return null;
  }
  return sample(schema, 0, new Set());
}
export function operationSample(op: Operation, document: unknown) {
  const params: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  for (const location of ["path", "query", "cookie"] as const) {
    const entries = op.parameters
      .filter((p) => p.in === location)
      .map((p) => [p.name, schemaSample(p.schema, document)]);
    if (entries.length)
      params[location === "cookie" ? "cookies" : location] =
        Object.fromEntries(entries);
  }
  for (const p of op.parameters.filter((p) => p.in === "header"))
    headers[p.name] = String(schemaSample(p.schema, document) ?? "demo");
  return {
    params,
    headers,
    body: op.body ? schemaSample(op.body.schema, document) : undefined,
    response:
      op.responseType === "void"
        ? undefined
        : schemaSample(op.response, document, "output"),
  };
}
export function parsePlayground(
  paramsText: string,
  bodyText: string,
  headersText: string,
  hasBody: boolean,
) {
  const params: unknown = JSON.parse(paramsText),
    headers: unknown = JSON.parse(headersText);
  if (!record(params)) throw new Error("params 必须是 JSON 对象");
  for (const [key, value] of Object.entries(params)) {
    if (!["path", "query", "cookies"].includes(key) || !record(value))
      throw new Error(
        "params 仅支持 path、query、cookies 对象；请求头请放在 headers",
      );
  }
  if (
    !record(headers) ||
    Object.values(headers).some((value) => typeof value !== "string")
  )
    throw new Error("headers 必须是值为字符串的 JSON 对象");
  // Validate header names/values before the hook constructs its cache key.
  new Headers(headers as Record<string, string>);
  return {
    params,
    body: hasBody ? (JSON.parse(bodyText) as unknown) : undefined,
    headers: headers as Record<string, string>,
  };
}

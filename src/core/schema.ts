import type { Json, Diagnostic } from "./model.js";
export function pointer(doc: Json, ref: string): any {
  if (!ref.startsWith("#/"))
    throw new Error(
      "Only local JSON references are supported; bundle external references first",
    );
  let value: any = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      throw new Error(`Unresolved local reference: ${ref}`);
    value = value[key];
  }
  return value;
}
export function resolve(doc: Json, value: any, seen = new Set<string>()): any {
  if (value && typeof value === "object" && typeof value.$ref === "string") {
    if (seen.has(value.$ref)) throw new Error("Circular non-schema reference");
    seen.add(value.$ref);
    return resolve(doc, pointer(doc, value.$ref), seen);
  }
  return value;
}
export function createSchemaWriter(doc: Json, diagnostics: Diagnostic[]) {
  const registry: Json = doc.components?.schemas ?? doc.definitions ?? {};
  const root = doc.swagger ? "#/definitions/" : "#/components/schemas/";
  const emitted = new Set<string>();
  let nodes = 0;
  const warn = (code: string, message: string, location: string) => {
    const key = `${code}:${location}`;
    if (!emitted.has(key)) {
      emitted.add(key);
      diagnostics.push({ level: "warning", code, message, location });
    }
  };
  function type(
    schema: any,
    direction: "input" | "output" | "neutral" = "neutral",
    location = "schema",
    depth = 0,
    refs = new Set<string>(),
  ): string {
    if (++nodes > 1000000 || depth > 80)
      throw new Error("Schema complexity limit exceeded");
    if (schema === true || schema === undefined || schema === null)
      return "unknown";
    if (schema === false) return "never";
    if (typeof schema !== "object")
      throw new Error(`Invalid schema at ${location}`);
    if (schema.$ref) {
      if (
        Object.keys(schema).some(
          (k) =>
            ![
              "$ref",
              "description",
              "summary",
              "nullable",
              "readOnly",
              "writeOnly",
            ].includes(k),
        )
      )
        warn("ref-siblings", "引用的兄弟约束未映射，仅使用引用本身", location);
      const ref = String(schema.$ref);
      if (ref.startsWith(root) && !ref.slice(root.length).includes("/")) {
        const name = decodeURIComponent(ref.slice(root.length))
          .replace(/~1/g, "/")
          .replace(/~0/g, "~");
        if (!Object.hasOwn(registry, name)) {
          warn(
            "missing-schema",
            `引用模型${name}不存在，已降为unknown`,
            location,
          );
          return "unknown";
        }
        return `${direction === "input" ? "InputSchemas" : direction === "output" ? "OutputSchemas" : "Schemas"}[${JSON.stringify(name)}]${schema.nullable ? " | null" : ""}`;
      }
      if (refs.has(ref)) {
        warn("inline-cycle", "内联循环引用无法命名，类型降为unknown", location);
        return "unknown";
      }
      const next = new Set(refs).add(ref);
      return type(pointer(doc, ref), direction, location, depth + 1, next);
    }
    const child = (s: any, l = location) =>
      type(s, direction, l, depth + 1, refs);
    let result: string;
    if (Object.hasOwn(schema, "const"))
      result = JSON.stringify(schema.const) ?? "unknown";
    else if (Array.isArray(schema.enum) && schema.enum.length)
      result = schema.enum
        .map((v: unknown) => JSON.stringify(v) ?? "unknown")
        .join(" | ");
    else if (schema.oneOf || schema.anyOf)
      result =
        (schema.oneOf ?? schema.anyOf)
          .map((s: any) => `(${child(s)})`)
          .join(" | ") || "never";
    else if (schema.allOf) {
      const parts = schema.allOf.map((s: any) => `(${child(s)})`);
      if (schema.properties)
        parts.push(`(${child({ ...schema, allOf: undefined })})`);
      result = parts.join(" & ") || "unknown";
    } else if (Array.isArray(schema.type))
      result = schema.type
        .map(
          (t: string) => `(${child({ ...schema, type: t, nullable: false })})`,
        )
        .join(" | ");
    else
      switch (
        schema.type ??
        (schema.properties ? "object" : schema.items ? "array" : undefined)
      ) {
        case "undefined":
          result = "undefined";
          break;
        case "null":
          result = "null";
          break;
        case "integer":
        case "number":
          result = "number";
          break;
        case "boolean":
          result = "boolean";
          break;
        case "string":
          result = schema.format === "binary" ? "Blob" : "string";
          break;
        case "file":
          result = "Blob";
          break;
        case "array":
          result = `Array<${child(schema.items ?? true, location + "[]")}>`;
          if (schema.prefixItems)
            warn(
              "tuple",
              "prefixItems元组约束未映射，数组元素类型可能不完整",
              location,
            );
          break;
        case "object": {
          const props = schema.properties ?? {};
          if (typeof props !== "object" || Array.isArray(props))
            throw new Error("Invalid properties object");
          const required = new Set(schema.required ?? []);
          const fields = Object.entries(props).flatMap(
            ([name, s]: [string, any]) => {
              if (
                (direction === "input" && s?.readOnly) ||
                (direction === "output" && s?.writeOnly)
              )
                return [];
              return [
                `${s?.readOnly ? "readonly " : ""}${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${child(s, location + "." + name)};`,
              ];
            },
          );
          if (schema.additionalProperties !== false)
            fields.push(
              `[key: string]: ${schema.additionalProperties && typeof schema.additionalProperties === "object" ? child(schema.additionalProperties) : "unknown"};`,
            );
          result = `{ ${fields.join(" ")} }`;
          break;
        }
        default:
          result = "unknown";
          warn(
            "unknown-schema",
            "Schema缺少可映射的类型，已使用unknown",
            location,
          );
      }
    for (const k of [
      "not",
      "if",
      "then",
      "else",
      "dependentSchemas",
      "patternProperties",
      "unevaluatedProperties",
    ])
      if (schema[k] !== undefined)
        warn(
          "schema-keyword",
          `${k}约束未映射到TypeScript；运行时仍须验证`,
          location,
        );
    return schema.nullable && !result.split(/\s*\|\s*/).includes("null")
      ? `(${result}) | null`
      : result;
  }
  return { type, registry };
}

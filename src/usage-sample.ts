const record = (v: unknown): v is Record<string, any> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
type Sample = { ok: true; value: unknown } | { ok: false };
/** Conservative structural examples; unsupported/recursive schemas require typed caller input. */
export function inputExample(schema: unknown, document?: unknown): Sample {
  let budget = 160;
  function visit(s: unknown, seen: Set<string>, depth: number): Sample {
    if (--budget < 0 || depth > 10 || !record(s)) return { ok: false };
    if (typeof s.$ref === "string") {
      if (!s.$ref.startsWith("#/") || seen.has(s.$ref)) return { ok: false };
      let target = document;
      for (const key of s.$ref
        .slice(2)
        .split("/")
        .map((v: string) => v.replace(/~1/g, "/").replace(/~0/g, "~")))
        target =
          record(target) && Object.hasOwn(target, key)
            ? target[key]
            : undefined;
      return visit(target, new Set([...seen, s.$ref]), depth + 1);
    }
    if (
      Object.hasOwn(s, "const") &&
      (s.const === null ||
        ["string", "number", "boolean"].includes(typeof s.const))
    )
      return { ok: true, value: s.const };
    if (Array.isArray(s.enum) && s.enum.length)
      return { ok: true, value: s.enum[0] };
    if (Array.isArray(s.allOf)) {
      const values: Record<string, unknown> = {};
      for (const part of s.allOf) {
        const v = visit(part, seen, depth + 1);
        if (!v.ok || !record(v.value)) return { ok: false };
        for (const [k, value] of Object.entries(v.value)) {
          if (
            Object.hasOwn(values, k) &&
            JSON.stringify(values[k]) !== JSON.stringify(value)
          )
            return { ok: false };
          values[k] = value;
        }
      }
      return { ok: true, value: values };
    }
    const choices = s.oneOf ?? s.anyOf;
    if (Array.isArray(choices)) {
      for (const part of choices) {
        const v = visit(part, seen, depth + 1);
        if (v.ok) return v;
      }
      return { ok: false };
    }
    const type = Array.isArray(s.type)
      ? (s.type.find((t: unknown) => t !== "null") ?? "null")
      : s.type;
    if (type === "null") return { ok: true, value: null };
    if (type === "array") {
      const v = visit(s.items, seen, depth + 1);
      return v.ok ? { ok: true, value: [v.value] } : v;
    }
    if (type === "object" || record(s.properties)) {
      const values: Record<string, unknown> = {};
      for (const key of Array.isArray(s.required) ? s.required : []) {
        if (typeof key !== "string") return { ok: false };
        const prop = s.properties?.[key];
        if (record(prop) && prop.readOnly) continue;
        const v = visit(prop, seen, depth + 1);
        if (!v.ok) return v;
        values[key] = v.value;
      }
      return { ok: true, value: values };
    }
    if (type === "string")
      return s.format === "binary"
        ? { ok: false }
        : {
            ok: true,
            value:
              s.format === "email"
                ? "hello@example.com"
                : s.format === "date"
                  ? "2026-01-01"
                  : s.format === "date-time"
                    ? "2026-01-01T00:00:00Z"
                    : "demo",
          };
    if (type === "integer" || type === "number") return { ok: true, value: 1 };
    if (type === "boolean") return { ok: true, value: true };
    return { ok: false };
  }
  return visit(schema, new Set(), 0);
}

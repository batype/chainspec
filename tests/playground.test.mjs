import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const dir = await mkdtemp(join(process.cwd(), ".verify-playground-"));
after(() => rm(dir, { recursive: true, force: true }));
const compiled = spawnSync(
  resolve("node_modules/.bin/tsc"),
  [
    "--ignoreConfig",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--outDir",
    dir,
    "src/playground.ts",
  ],
  { encoding: "utf8" },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const { schemaSample, operationSample, parsePlayground } = await import(
  pathToFileURL(join(dir, "playground.js"))
);

test("playground resolves local refs, respects input/output fields, and bounds recursive or remote schemas", () => {
  const document = {
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "integer", readOnly: true },
            password: { type: "string", writeOnly: true },
            role: { type: "string", enum: ["admin", "member"] },
            child: { $ref: "#/components/schemas/User" },
          },
        },
      },
    },
  };
  const ref = { $ref: "#/components/schemas/User" };
  assert.deepEqual(schemaSample(ref, document), {
    password: "demo",
    role: "admin",
    child: null,
  });
  assert.deepEqual(schemaSample(ref, document, "output"), {
    id: 1,
    role: "admin",
    child: null,
  });
  assert.equal(
    schemaSample({ $ref: "https://example.com/private.json" }, document),
    null,
  );
  assert.deepEqual(
    schemaSample(
      {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 1000 }, (_, i) => [i, { type: "string" }]),
        ),
      },
      {},
    ),
    Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, "demo"])),
  );
  assert.equal(schemaSample({ type: "boolean", example: false }, {}), false);
});

test("playground keeps path, query, cookies, headers and body in the same positions as generated SDK", () => {
  const sample = operationSample(
    {
      parameters: [
        { name: "id", in: "path", schema: { type: "integer" } },
        { name: "page", in: "query", schema: { type: "integer" } },
        { name: "session", in: "cookie", schema: { type: "string" } },
        { name: "X-Client", in: "header", schema: { type: "string" } },
      ],
      body: {
        schema: { type: "object", properties: { title: { type: "string" } } },
      },
      response: { type: "array", items: { type: "integer" } },
      responseType: "json",
    },
    {},
  );
  assert.deepEqual(sample, {
    params: {
      path: { id: 1 },
      query: { page: 1 },
      cookies: { session: "demo" },
    },
    headers: { "X-Client": "demo" },
    body: { title: "demo" },
    response: [1],
  });
  assert.deepEqual(
    parsePlayground(
      '{"path":{"id":2},"query":{"page":3}}',
      '{"title":"next"}',
      '{"X-Client":"demo"}',
      true,
    ),
    {
      params: { path: { id: 2 }, query: { page: 3 } },
      body: { title: "next" },
      headers: { "X-Client": "demo" },
    },
  );
  assert.equal(
    operationSample({ parameters: [], responseType: "void" }, {}).response,
    undefined,
  );
});

test("playground rejects invalid JSON, params shapes and headers before binding hook arguments", () => {
  for (const params of ["[]", "null", '{"headers":{}}', '{"path":"x"}', "{"])
    assert.throws(() => parsePlayground(params, "{}", "{}", true));
  for (const headers of [
    "[]",
    '{"X-A":1}',
    '{"Bad Name":"test"}',
    '{"X-A":"a\\nb"}',
  ])
    assert.throws(() => parsePlayground("{}", "{}", headers, true));
  assert.throws(() => parsePlayground("{}", "{", "{}", true));
  assert.equal(
    parsePlayground("{}", "not a body", "{}", false).body,
    undefined,
  );
});

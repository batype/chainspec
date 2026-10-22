import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { generateSDK } from "../lib/core/index.js";
const dir = await mkdtemp(join(process.cwd(), ".verify-"));
after(() => rm(dir, { recursive: true, force: true }));
const response = (schema) => ({
  200: { description: "OK", content: { "application/json": { schema } } },
});
const spec = {
  openapi: "3.0.3",
  info: { title: "Fixture", version: "1" },
  servers: [{ url: "https://example.com/api" }],
  paths: {
    "/v1/api/users/{id}": {
      parameters: [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
      ],
      get: {
        operationId: "GetUser",
        responses: response({ $ref: "#/components/schemas/User" }),
        parameters: [
          { in: "query", name: "q", schema: { type: "string" } },
          {
            in: "query",
            name: "tag",
            schema: { type: "array", items: { type: "string" } },
          },
          {
            in: "query",
            name: "filter",
            style: "deepObject",
            schema: {
              type: "object",
              properties: { name: { type: "string" } },
            },
          },
        ],
      },
      delete: {
        operationId: "Remove",
        responses: { 204: { description: "gone" } },
      },
    },
    "/v1/api/users": {
      post: {
        operationId: "Create",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/User" },
            },
          },
        },
        responses: response({ $ref: "#/components/schemas/User" }),
      },
    },
    "/v1/api/users/{id}/alternate": {
      get: {
        operationId: "GetUser",
        responses: response({ $ref: "#/components/schemas/Missing" }),
      },
    },
    "/v1/api/files": {
      post: {
        operationId: "Upload",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
                required: ["file"],
              },
            },
          },
        },
        responses: response({ type: "string" }),
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string" },
          password: { type: "string", writeOnly: true },
          role: { type: "string", enum: ["admin", "user"] },
          next: { $ref: "#/components/schemas/User", nullable: true },
        },
        required: ["id", "name"],
      },
      Combined: {
        allOf: [
          { $ref: "#/components/schemas/User" },
          { type: "object", properties: { extra: { type: "boolean" } } },
        ],
      },
      Choice: { oneOf: [{ type: "string" }, { type: "number" }] },
    },
  },
};
const project = generateSDK(spec);
for (const [name, text] of Object.entries(project.files))
  await writeFile(join(dir, name), text);
await writeFile(join(dir, "package.json"), ' {"type":"module"}');
const output = join(dir, "js");
const compile = spawnSync(
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
    "--lib",
    "ES2022,DOM,DOM.Iterable",
    "--outDir",
    output,
    ...Object.keys(project.files)
      .filter((n) => n.endsWith(".ts"))
      .map((n) => join(dir, n)),
  ],
  { encoding: "utf8" },
);
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
const { createAPI } = await import(pathToFileURL(join(output, "client.js")));
const { ApiError } = await import(pathToFileURL(join(output, "runtime.js")));
const op = project.operations.find(
  (o) => o.method === "GET" && o.path.includes("{id}"),
);
const endpoint = (api) => api.main[op.controller][op.name];

test("generated SDK compiles; names, refs, recursive models, directional types and unknown diagnostics", () => {
  assert.equal(project.operations.length, 5);
  assert(project.diagnostics.some((d) => d.code === "operation-collision"));
  assert(project.diagnostics.some((d) => d.code === "missing-schema"));
  assert(project.files["types.ts"].includes('readonly "id"'));
  assert(project.files["types.ts"].includes('InputSchemas["User"]'));
  assert(project.files["types.ts"].includes('OutputSchemas["User"]'));
  const ids = project.operations.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert(project.files["react.ts"].includes("withMutation"));
  assert(!project.files["index.ts"].includes("swr"));
  assert.equal(
    generateSDK(spec, { hooks: false }).files["hooks.ts"],
    undefined,
  );
});

test("type contracts reject missing required args, wrong params/body and response access", async () => {
  const file = join(dir, "contract.ts");
  await writeFile(
    file,
    `import {createAPI} from './client.js';\nconst API=createAPI();\n// @ts-expect-error path is required\nAPI.main.users.getUser.request();\n// @ts-expect-error path id must be a string\nAPI.main.users.getUser.request({path:{id:12}});\n// @ts-expect-error name in body is required\nAPI.main.users.create.request({body:{}});\nAPI.main.users.create.request({body:{name:'A'}});\nasync function contract(){const data=await API.main.users.getUser.request({path:{id:'1'}});const n:string=data.name;\n// @ts-expect-error writeOnly password excluded from response\nconst secret=data.password;\n}\n`,
  );
  const result = spawnSync(
    resolve("node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("request adapter receives encoded params and structured body; middleware order is deterministic", async () => {
  const events = [];
  let context;
  const API = createAPI({
    headers: { "X-Default": "a" },
    beforeRequest: [
      async (c) => {
        events.push("before-global");
        c.headers.set("X-Auth", "ok");
      },
    ],
    afterResponse: [
      (r) => {
        events.push("after-global");
        return { ...r, data: { ...r.data, marked: true } };
      },
    ],
    request: async (c) => {
      events.push("adapter");
      context = c;
      return { status: 200, data: { name: "Ada" }, headers: new Headers() };
    },
  });
  const data = await endpoint(API).request(
    {
      path: { id: "a/b ?#" },
      query: { q: "&admin=true", tag: ["a b", "c"], filter: { name: "x/y" } },
    },
    {
      headers: { "X-Call": "b" },
      beforeRequest: [
        (c) => {
          events.push("before-call");
          return c;
        },
      ],
      afterResponse: [
        (r) => {
          events.push("after-call");
          return r;
        },
      ],
    },
  );
  assert.deepEqual(events, [
    "before-global",
    "before-call",
    "adapter",
    "after-global",
    "after-call",
  ]);
  assert.equal(data.marked, true);
  const url = new URL(context.url);
  assert(url.pathname.endsWith("/a%2Fb%20%3F%23"));
  assert.equal(url.searchParams.get("q"), "&admin=true");
  assert.deepEqual(url.searchParams.getAll("tag"), ["a b", "c"]);
  assert.equal(url.searchParams.get("filter[name]"), "x/y");
  assert.equal(context.headers.get("X-Auth"), "ok");
  assert.equal(context.headers.get("X-Call"), "b");
});

test("default Fetch JSON/multipart, HTTP errors, aborts and per-call error handling", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ name: "Ada" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const API = createAPI();
    await API.main.users.create.request({ body: { name: "Ada" } });
    assert.equal(sent.init.body, '{"name":"Ada"}');
    assert.equal(sent.init.headers.get("Content-Type"), "application/json");
    await API.main.files.upload.request({ body: { file: new Blob(["a"]) } });
    assert(sent.init.body instanceof FormData);
    assert.equal(sent.init.headers.has("Content-Type"), false);
    let count = 0;
    globalThis.fetch = async () =>
      new Response('{"reason":"bad"}', {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      endpoint(API).request(
        { path: { id: "x" } },
        {
          onError: [
            (e) => {
              assert(e instanceof ApiError);
              count++;
            },
          ],
        },
      ),
      (e) => e.status === 400 && e.data.reason === "bad",
    );
    assert.equal(count, 1);
    const abort = new DOMException("cancelled", "AbortError");
    globalThis.fetch = async () => {
      throw abort;
    };
    await assert.rejects(
      endpoint(API).request({ path: { id: "x" } }),
      (e) => e === abort,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("runtime rejects missing path/body before adapter; caches isolate clients, params and identity scope", async () => {
  let calls = 0,
    identity = "one";
  const config = {
    cacheScope: () => identity,
    request: async () => {
      calls++;
      return { data: {}, status: 200, headers: new Headers() };
    },
  };
  const A = createAPI(config),
    B = createAPI(config);
  await assert.rejects(endpoint(A).request({}), /Missing path/);
  await assert.rejects(A.main.users.create.request({}), /body is required/);
  assert.equal(calls, 0);
  const first = endpoint(A).getKey({ path: { id: "a" } });
  assert.notDeepEqual(first, endpoint(A).getKey({ path: { id: "b" } }));
  assert.notDeepEqual(first, endpoint(B).getKey({ path: { id: "a" } }));
  identity = "two";
  assert.notDeepEqual(first, endpoint(A).getKey({ path: { id: "a" } }));
});

test("Swagger2, local pointer refs, namespaced aliases and absent path declarations are diagnosed", () => {
  const d = {
    swagger: "2.0",
    info: { title: "v2" },
    host: "example.com",
    basePath: "/api",
    paths: {
      "/v1/api/user/{id}": {
        get: {
          operationId: "constructor",
          tags: ["用户"],
          responses: { 200: { schema: { $ref: "#/definitions/Foo" } } },
        },
      },
    },
    definitions: {
      Foo: { type: "object", properties: { value: { type: "string" } } },
    },
  };
  const r = generateSDK(d, {
    namespace: "mian",
    groupBy: "tag",
    controllerNames: { 用户: "members" },
  });
  assert.equal(r.operations[0].id, "mian.members.constructorApi");
  assert(r.diagnostics.some((x) => x.code === "inferred-path"));
  assert(r.files["client.ts"].includes("https://example.com/api"));
});

test("bad document, external refs and unsupported serialization fail explicitly", () => {
  assert.throws(() => generateSDK("<html>Swagger UI</html>"), /有效JSON/);
  assert.throws(() => generateSDK({ ...spec, openapi: "3.2.0" }), /支持/);
  assert.throws(
    () => generateSDK(spec, { namespace: "__proto__" }),
    /命名空间/,
  );
  assert.throws(
    () =>
      generateSDK({
        ...spec,
        components: {
          schemas: { Bad: { $ref: "https://example.com/external.json" } },
        },
      }),
    /local JSON references/,
  );
  const modified = structuredClone(spec);
  modified.paths["/v1/api/users/{id}"].parameters[0].style = "matrix";
  assert.throws(() => generateSDK(modified), /serialization style/);
});

test("SWR hooks: queries read, disabled query pauses, writes only execute after trigger", async () => {
  const React = await import("react");
  const { create, act } = await import("react-test-renderer");
  const { SWRConfig } = await import("swr");
  const { createReactAPI } = await import(
    pathToFileURL(join(output, "react.js"))
  );
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  let read, mutation;
  const API = createReactAPI({
    request: async (c) => {
      calls.push(c.method);
      return { data: { name: "Ada" }, status: 200, headers: new Headers() };
    },
  });
  function View({ enabled }) {
    read = API.main.users.getUser.useRequest(
      enabled ? { path: { id: "one" } } : null,
    );
    mutation = API.main.users.create.useRequest();
    return React.createElement(
      "span",
      null,
      read.data?.name ?? read.error?.message ?? "pending",
    );
  }
  let root;
  await act(async () => {
    root = create(
      React.createElement(
        SWRConfig,
        {
          value: {
            provider: () => new Map(),
            dedupingInterval: 0,
            shouldRetryOnError: false,
          },
        },
        React.createElement(View, { enabled: false }),
      ),
    );
  });
  assert.deepEqual(calls, []);
  await act(async () =>
    root.update(
      React.createElement(
        SWRConfig,
        {
          value: {
            provider: () => new Map(),
            dedupingInterval: 0,
            shouldRetryOnError: false,
          },
        },
        React.createElement(View, { enabled: true }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(calls, ["GET"]);
  assert.equal(
    read.data?.name,
    "Ada",
    JSON.stringify({ error: read.error?.message, data: read.data }),
  );
  await act(async () => {
    await mutation.trigger({ body: { name: "New" } });
  });
  assert.deepEqual(calls, ["GET", "POST"]);
  await act(async () => root.unmount());
});

test("CLI generates only in a new directory and does not overwrite existing output", async () => {
  const source = join(dir, "spec.json"),
    out = join(dir, "cli-sdk");
  await writeFile(source, JSON.stringify(spec));
  const run = (args) =>
    spawnSync(process.execPath, ["bin/chainspec.mjs", ...args], {
      encoding: "utf8",
    });
  assert.equal(run(["--in", source, "--out", out]).status, 0);
  const before = await readFile(join(out, "client.ts"), "utf8");
  const second = run(["--in", source, "--out", out]);
  assert.equal(second.status, 1);
  assert(second.stderr.includes("already exists"));
  assert.equal(await readFile(join(out, "client.ts"), "utf8"), before);
});

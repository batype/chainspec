import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { generateSDK, DEFAULT_CONFIG } from "../lib/core/index.js";
const root = await mkdtemp(join(process.cwd(), ".verify-usability-"));
after(() => rm(root, { recursive: true, force: true }));
const tsc = resolve("node_modules/.bin/tsc"),
  cli = resolve("bin/chainspec.mjs");
function run(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}
function compile(args, cwd = process.cwd()) {
  const r = run(tsc, args, cwd);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
compile([
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
  join(root, "ui"),
  "src/usage.ts",
  "src/editor-state.ts",
  "src/example.ts",
]);
const { usage } = await import(pathToFileURL(join(root, "ui/usage.js")));
const {
  generationKey,
  configFieldErrors,
  inspectDocument,
  exportWorkspace,
  importWorkspace,
} = await import(pathToFileURL(join(root, "ui/editor-state.js")));
const { exampleText } = await import(
  pathToFileURL(join(root, "ui/example.js"))
);
const base = { ...DEFAULT_CONFIG, translateNames: false, target: "node" };

test("only output/target/hooks changes reuse code, while source and naming changes invalidate; inline errors point to real field IDs", () => {
  const key = (patch) =>
    generationKey(exampleText, JSON.stringify({ ...base, ...patch }));
  assert.equal(key({ output: "./src/services" }), key({}));
  assert.equal(key({ target: "react", hooks: true }), key({}));
  for (const change of [
    { namespace: "admin" },
    { input: "./other.json" },
    { baseUrl: "https://other.test" },
    { groupBy: "tag" },
    { controllerNames: { 用户管理: "users" } },
  ])
    assert.notEqual(key(change), key({}));
  assert.notEqual(generationKey("{}", JSON.stringify(base)), key({}));
  assert.deepEqual(configFieldErrors(base), {});
  const errors = configFieldErrors({
    ...base,
    namespace: "中文",
    stripPrefix: "api",
    input: "",
    output: "",
    controllerNames: { "": "", 用户管理: "user-name" },
  });
  for (const id of [
    "config-namespace",
    "config-prefix",
    "config-source",
    "config-output",
    "mapping-tag-0",
    "mapping-name-0",
    "mapping-name-1",
  ])
    assert(errors[id], id);
});

test("document inspection is bounded and offline, reports actual source title, counts and server variables", () => {
  const before = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("inspection must not fetch");
  };
  try {
    assert.deepEqual(inspectDocument(exampleText), {
      title: "Workspace API",
      version: "1.0.0",
      operations: 6,
      schemaCount: 3,
      baseUrl: "https://api.example.com",
    });
    assert.throws(() => inspectDocument("{bad"), /JSON/);
    assert.throws(
      () => inspectDocument(JSON.stringify({ openapi: "3.0.3", paths: {} })),
      /HTTP/,
    );
  } finally {
    globalThis.fetch = before;
  }
});

const props = {
  status: { type: "string", enum: ["active", "inactive"] },
  fixed: { const: "fixed" },
  tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
  filter: { $ref: "#/components/schemas/Filter" },
  unknown: {
    type: "object",
    properties: { self: { $ref: "#/components/schemas/Cycle" } },
    required: ["self"],
  },
};
const spec = {
  openapi: "3.1.0",
  info: { title: "Usability fixture", version: "1" },
  servers: [{ url: "https://example.test" }],
  components: {
    schemas: {
      Filter: {
        type: "object",
        properties: { state: { type: "string", enum: ["ok", "bad"] } },
        required: ["state"],
      },
      Cycle: {
        type: "object",
        properties: { next: { $ref: "#/components/schemas/Cycle" } },
        required: ["next"],
      },
    },
  },
  paths: {},
};
for (const [name, schema] of Object.entries(props))
  spec.paths["/users/" + name] = {
    get: {
      operationId: name,
      parameters: [{ name: "value", in: "query", required: true, schema }],
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: { type: "string" } } },
        },
      },
    },
  };
async function saveSDK(p, dir) {
  await mkdir(dir, { recursive: true });
  for (const [n, s] of Object.entries(p.files))
    await writeFile(join(dir, n), s);
}

test("workspace examples compile for enums, constants, arrays, local refs and recursive required parameters across request/Hook/server contexts", async () => {
  for (const target of ["node", "react", "next", "vite-ssr"]) {
    const dir = join(root, "examples-" + target);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    const p = generateSDK(spec, { target });
    await saveSDK(p, join(dir, "sdk"));
    compile(["-p", join(dir, "sdk/tsconfig.json")]);
    const files = [];
    for (const [opIndex, op] of p.operations.entries())
      for (const [envIndex, env] of (target === "react"
        ? ["react"]
        : target === "next"
          ? ["next-server", "next-client"]
          : target === "vite-ssr"
            ? ["vite-ssr", "react"]
            : ["node"]
      ).entries())
        for (const mode of env.includes("server") ||
        env === "node" ||
        env === "vite-ssr"
          ? ["request"]
          : ["request", "hook"]) {
          const code = usage(p, op, mode, env, spec);
          assert(!code.includes('"填写参数"'));
          if (op.name === "unknown")
            assert(code.includes("params: Operations["));
          const file = join(dir, `${opIndex}-${envIndex}-${mode}.ts`);
          await writeFile(file, code);
          files.push(file);
        }
    compile([
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      ...files,
    ]);
  }
});

test("CLI generate → default npm build → update preserves dist and rebuilds, while extra/source/symlink protections remain", async () => {
  const input = join(root, "openapi.json");
  await writeFile(input, exampleText);
  for (const target of ["node", "next"]) {
    const dir = join(root, "managed-" + target),
      args = [
        "--in",
        input,
        "--out",
        dir,
        "--target",
        target,
        "--no-translate",
      ];
    let r = run(process.execPath, [cli, ...args]);
    assert.equal(r.status, 0, r.stderr);
    r = run("npm", ["run", "build"], dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const compiled = await readFile(join(dir, "dist/index.js"), "utf8");
    await writeFile(
      join(dir, "dist/retained-note.txt"),
      "user-owned build folder note",
    );
    r = run(process.execPath, [
      cli,
      ...args,
      "--namespace",
      "admin",
      "--update",
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Preserved dist/);
    assert.equal(await readFile(join(dir, "dist/index.js"), "utf8"), compiled);
    assert.equal(
      await readFile(join(dir, "dist/retained-note.txt"), "utf8"),
      "user-owned build folder note",
    );
    assert.match(await readFile(join(dir, "types.ts"), "utf8"), /admin\./);
    r = run("npm", ["run", "build"], dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    await writeFile(join(dir, "notes.txt"), "keep");
    r = run(process.execPath, [cli, ...args, "--update"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /extra files/);
    await rm(join(dir, "notes.txt"));
    await symlink(input, join(dir, "dist/unsafe-link"));
    r = run(process.execPath, [cli, ...args, "--update"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /symlinks/);
    await rm(join(dir, "dist/unsafe-link"));
    const saved = join(root, "saved-dist-" + target);
    await rename(join(dir, "dist"), saved);
    await symlink(saved, join(dir, "dist"));
    r = run(process.execPath, [cli, ...args, "--update"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /symlink/);
    await rm(join(dir, "dist"));
    await rename(saved, join(dir, "dist"));
    await writeFile(join(dir, "index.ts"), "// manual source");
    r = run(process.execPath, [cli, ...args, "--update"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /changed/);
    assert.equal(
      await readFile(join(dir, "index.ts"), "utf8"),
      "// manual source",
    );
    assert.equal(
      await readFile(join(dir, "dist/retained-note.txt"), "utf8"),
      "user-owned build folder note",
    );
  }
});

test("minimal first-call code supports configured output paths containing quotes and spaces without extra middleware setup", async () => {
  const dir = join(root, "custom-output");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), '{"type":"module"}');
  const p = generateSDK(exampleText, { target: "node" }),
    output = join(dir, "source's SDK");
  await saveSDK(p, output);
  compile(["-p", join(output, "tsconfig.json")]);
  const code = usage(
    p,
    p.operations.find((op) => op.name === "getUser"),
    "request",
    "node",
    JSON.parse(exampleText),
    "./source's SDK/dist",
    true,
  );
  assert(!code.includes("cacheScope"));
  assert(!code.includes("beforeRequest"));
  await writeFile(join(dir, "first.ts"), code);
  compile([
    "--ignoreConfig",
    "--strict",
    "--skipLibCheck",
    "--noEmit",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--lib",
    "ES2022,DOM,DOM.Iterable",
    join(dir, "first.ts"),
  ]);
});

test("local workspace backup roundtrips documents and validated configuration, rejects credentials and oversized or unrelated payloads", () => {
  const text = exportWorkspace(exampleText, base),
    restored = importWorkspace(text);
  assert.equal(restored.document, exampleText);
  assert.equal(restored.config.output, base.output);
  assert.equal(restored.config.target, "node");
  assert.throws(
    () =>
      importWorkspace(
        JSON.stringify({
          kind: "wrong",
          version: 1,
          document: exampleText,
          config: base,
        }),
      ),
    /工作包/,
  );
  assert.throws(
    () =>
      exportWorkspace(exampleText, {
        ...base,
        sourceRequest: { auth: { type: "bearer", token: "secret-value" } },
      }),
    /环境变量|token|凭据|配置/i,
  );
  assert.throws(
    () =>
      importWorkspace(
        JSON.stringify({
          kind: "ChainSpecWorkspace",
          version: 1,
          document: "x".repeat(8 * 1024 * 1024 + 1),
          config: base,
        }),
      ),
    /8 MiB/,
  );
});

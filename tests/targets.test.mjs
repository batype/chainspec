import { build } from "vite";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  generateSDK,
  generateSDKAsync,
  selectSDKTarget,
  SDK_TARGETS,
  parseConfig,
  DEFAULT_CONFIG,
} from "../lib/core/index.js";
const dir = await mkdtemp(join(process.cwd(), ".verify-targets-"));
after(() => rm(dir, { recursive: true, force: true }));
const schema = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};
const responses = {
  200: { description: "OK", content: { "application/json": { schema } } },
};
const post = {
  operationId: "createUser",
  requestBody: { required: true, content: { "application/json": { schema } } },
  responses,
};
const spec = {
  openapi: "3.0.3",
  info: { title: "Target fixture", version: "1" },
  paths: {
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses,
      },
    },
    "/users": { post },
  },
};
const full = generateSDK(spec);
const shared = [
  "LICENSE.runtime.txt",
  "types.ts",
  "runtime.ts",
  "index.ts",
  "package.json",
  "controller-names.json",
  "manifest.json",
  "README.md",
];
const expected = {
  node: [...shared, "client.ts", "node.ts", "tsconfig.json"],
  browser: [...shared, "client.ts", "tsconfig.json"],
  react: [...shared, "hooks.ts", "react.ts", "tsconfig.json"],
  next: [
    ...shared,
    "client.ts",
    "node.ts",
    "hooks.ts",
    "react.ts",
    "tsconfig.json",
  ],
  "vite-ssr": [
    ...shared,
    "client.ts",
    "node.ts",
    "hooks.ts",
    "react.ts",
    "tsconfig.json",
  ],
};
const tsc = resolve("node_modules/.bin/tsc");
function execute(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", ...options });
  return r;
}
function compile(args) {
  const r = execute(tsc, args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function save(project, root) {
  await mkdir(root, { recursive: true });
  for (const [name, text] of Object.entries(project.files))
    await writeFile(join(root, name), text);
}

test("each target emits an exact dependency closure and matching build, manifest, package exports and guidance", () => {
  for (const { value: target } of SDK_TARGETS) {
    const project = generateSDK(spec, { target });
    assert.equal(project.target, target);
    assert.equal(JSON.parse(project.files["manifest.json"]).target, target);
    assert.equal(project.files["runtime.ts"], full.files["runtime.ts"]);
    assert.equal(project.files["types.ts"], full.files["types.ts"]);
    if (target === "all") {
      assert(project.files["ENVIRONMENTS.md"]);
      assert(project.files["tsconfig.node.json"]);
      continue;
    }
    assert.deepEqual(
      Object.keys(project.files).sort(),
      expected[target].sort(),
      target,
    );
    const metadata = JSON.parse(project.files["package.json"]);
    assert.deepEqual(metadata.scripts, { build: "tsc -p tsconfig.json" });
    for (const [entry, path] of Object.entries(metadata.exports)) {
      const source = entry === "." ? "index" : entry.slice(2);
      assert(project.files[source + ".ts"]);
      assert.equal(path.import, `./dist/${source}.js`);
    }
    if (target === "node" || target === "browser") {
      assert(!metadata.peerDependencies);
      assert(!metadata.devDependencies["@types/react"]);
      assert(!project.files["hooks.ts"]);
    }
    if (target === "react") {
      assert(!project.files["client.ts"]);
      assert(!project.files["node.ts"]);
      assert(!project.files["index.ts"].includes('"use client";'));
      assert(!metadata.exports["./node"]);
    }
  }
});

test("web target selection and direct generator output are byte-identical, including no-hooks compatibility", () => {
  for (const { value: target } of SDK_TARGETS) {
    assert.deepEqual(
      selectSDKTarget(full, target).files,
      generateSDK(spec, { target }).files,
      target,
    );
    if (target !== "react")
      assert.deepEqual(
        selectSDKTarget(full, target, { hooks: false }).files,
        generateSDK(spec, { target, hooks: false }).files,
        `${target} no-hooks`,
      );
  }
});

test("all selected SDKs and their README examples compile and expose only the selected API entry points", async () => {
  for (const target of Object.keys(expected)) {
    const project = generateSDK(spec, { target }),
      root = join(dir, target);
    await save(project, root);
    compile(["-p", join(root, "tsconfig.json")]);
    const index = await import(pathToFileURL(join(root, "dist/index.js")));
    const factory = target === "react" ? index.createReactAPI : index.createAPI;
    const API = factory({
      request: async () => ({
        status: 200,
        headers: new Headers(),
        data: { name: target },
      }),
    });
    const op = project.operations.find((item) => item.method === "GET"),
      ep = API.main[op.controller][op.name];
    assert.deepEqual(await ep.request({ path: { id: "42" } }), {
      name: target,
    });
    if (target === "node" || target === "browser")
      assert.equal(ep.useRequest, undefined);
    if (target === "react") {
      assert.equal(index.createAPI, undefined);
      assert.equal(typeof ep.useRequest, "function");
    }
    if (project.files["react.ts"]) {
      const react = await import(pathToFileURL(join(root, "dist/react.js")));
      assert.equal(typeof react.createReactAPI, "function");
    }
    const examples = [];
    for (const [i, match] of [
      ...project.files["README.md"].matchAll(/```(ts|tsx)\n([\s\S]*?)```/g),
    ].entries()) {
      const name = `example-${i}.${match[1]}`;
      await writeFile(join(root, name), match[2]);
      examples.push(join(root, name));
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
      "--jsx",
      "react-jsx",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      ...examples,
    ]);
  }
});

test("POST-only target guidance keeps typed body positions and no-hooks server targets build without React", async () => {
  const onlyPost = { ...spec, paths: { "/users": { post } } };
  for (const target of ["react", "next", "vite-ssr"]) {
    const project = generateSDK(onlyPost, { target }),
      root = join(dir, "post-" + target);
    await save(project, root);
    compile(["-p", join(root, "tsconfig.json")]);
    const examples = [];
    for (const [i, match] of [
      ...project.files["README.md"].matchAll(/```(ts|tsx)\n([\s\S]*?)```/g),
    ].entries()) {
      const path = join(root, `body-${i}.${match[1]}`);
      await writeFile(path, match[2]);
      examples.push(path);
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
      "--jsx",
      "react-jsx",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      ...examples,
    ]);
  }
  for (const target of ["next", "vite-ssr"]) {
    const project = generateSDK(spec, { target, hooks: false });
    assert(!project.files["react.ts"]);
    assert(!JSON.parse(project.files["package.json"]).peerDependencies);
    const root = join(dir, "server-" + target);
    await save(project, root);
    compile(["-p", join(root, "tsconfig.json")]);
  }
});

test("target JSON validation rejects unknown values and incompatible flags before translation or fetching", async () => {
  for (const target of ["bad", "React", null, 1]) {
    assert.throws(() => generateSDK(spec, { target }), /target/);
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, target }), /target/);
  }
  assert.throws(
    () => parseConfig({ ...DEFAULT_CONFIG, target: "react", hooks: false }),
    /Hooks/,
  );
  let calls = 0;
  await assert.rejects(
    generateSDKAsync(
      spec,
      { target: "invalid" },
      {
        translate: async () => {
          calls++;
          return "ignored";
        },
      },
    ),
    /target/,
  );
  assert.equal(calls, 0);
  assert.equal(
    generateSDK(spec, { target: "node", hooks: true }).files["react.ts"],
    undefined,
  );
});

test("CLI --target overrides JSON and --update switches output sets while preserving modified-file protection", async () => {
  const root = join(dir, "cli");
  await mkdir(root);
  await writeFile(join(root, "spec.json"), JSON.stringify(spec));
  const config = {
    ...DEFAULT_CONFIG,
    input: "./spec.json",
    output: "./sdk",
    target: "react",
    translateNames: false,
  };
  await writeFile(join(root, "chainspec.config.json"), JSON.stringify(config));
  const cli = resolve("bin/chainspec.mjs");
  const run = (args) =>
    execute(process.execPath, [cli, ...args], { cwd: root });
  let r = run(["--config", "chainspec.config.json", "--target", "node"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(await readFile(join(root, "sdk/manifest.json"))).target,
    "node",
  );
  await assert.rejects(readFile(join(root, "sdk/react.ts")), {
    code: "ENOENT",
  });
  r = run(["--config", "chainspec.config.json", "--update"]);
  assert.equal(r.status, 0, r.stderr);
  await assert.rejects(readFile(join(root, "sdk/node.ts")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "sdk/client.ts")), {
    code: "ENOENT",
  });
  assert(
    !(await readFile(join(root, "sdk/react.ts"), "utf8")).startsWith(
      '"use client";',
    ),
  );
  await writeFile(join(root, "sdk/index.ts"), "// custom change");
  r = run([
    "--config",
    "chainspec.config.json",
    "--target",
    "node",
    "--update",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changed/);
  assert.equal(
    await readFile(join(root, "sdk/index.ts"), "utf8"),
    "// custom change",
  );
  r = run([
    "--in",
    "https://example.invalid/spec.json",
    "--out",
    "./bad",
    "--target",
    "invalid",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /target/);
});

test("client boundaries follow the selected framework without changing Hook implementation", async () => {
  for (const { value: target } of SDK_TARGETS) {
    const project = generateSDK(spec, { target });
    const boundary = target === "next" || target === "all";
    for (const [name, source] of Object.entries(project.files).filter(
      ([name]) => name.endsWith(".ts"),
    )) {
      assert.equal(
        source.startsWith('"use client";'),
        boundary && ["react.ts", "hooks.ts"].includes(name),
        `${target}/${name}`,
      );
    }
    if (target === "react" || target === "vite-ssr") {
      for (const name of ["react.ts", "hooks.ts"])
        assert.equal(
          project.files[name],
          full.files[name].replace(/^"use client";\r?\n/, ""),
        );
      assert(!project.files["README.md"].includes('"use client";'));
    }
    if (target === "next") {
      assert(project.files["README.md"].includes('"use client";'));
      const root = join(dir, "boundary-next");
      // The emitted client marker must also survive the actual SDK TypeScript build.
      await save(project, root);
      compile(["-p", join(root, "tsconfig.json")]);
      await Promise.all(
        ["react", "hooks"].map(async (name) => {
          assert(
            (await readFile(join(root, `dist/${name}.js`), "utf8")).startsWith(
              '"use client";',
            ),
          );
        }),
      );
    }
  }
});

test("Vite SPA and SSR targets build without SDK directive warnings and SSR renders fallback data without Hook fetching", async () => {
  for (const target of ["react", "vite-ssr"]) {
    const root = join(dir, "vite-" + target);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await save(generateSDK(spec, { target }), join(root, "sdk"));
    await writeFile(
      join(root, "index.html"),
      '<div id="app"></div><script type="module" src="/entry-client.ts"></script>',
    );
    await writeFile(
      join(root, "entry-client.ts"),
      `import * as React from 'react';import {createRoot} from 'react-dom/client';import {createReactAPI} from './sdk/${target === "react" ? "index" : "react"}.js';const API=createReactAPI();function View(){const {data}=API.main.users.getUser.useRequest({path:{id:'42'}},{enabled:false});return React.createElement('p',null,data?.name);}createRoot(document.getElementById('app')!).render(React.createElement(View));`,
    );
    const warnings = [];
    const buildOptions = {
      configFile: false,
      root,
      logLevel: "silent",
      build: {
        rolldownOptions: {
          onLog(level, log) {
            if (level === "warn") warnings.push(log);
          },
        },
      },
    };
    await build({
      ...buildOptions,
      build: { ...buildOptions.build, outDir: join(root, "browser") },
    });
    if (target === "vite-ssr") {
      await writeFile(
        join(root, "entry-server.ts"),
        `import * as React from 'react';import {renderToString} from 'react-dom/server';import {createAPI} from './sdk/node.js';import {createReactAPI} from './sdk/react.js';export async function render(name:string){let requests=0;const API=createAPI({request:async()=>{requests++;return{status:200,headers:new Headers(),data:{name}}}});const initial=await API.main.users.getUser.request({path:{id:name}});let hookRequests=0;function View(){const[client]=React.useState(()=>createReactAPI({request:async()=>{hookRequests++;throw Error('SSR must not fetch in Hook')}}));const{data}=client.main.users.getUser.useRequest({path:{id:name}},{swr:{fallbackData:initial,revalidateOnMount:false}});return React.createElement('p',null,data?.name);}const html=renderToString(React.createElement(View));return{html,requests,hookRequests};}`,
      );
      await build({
        ...buildOptions,
        build: {
          ...buildOptions.build,
          ssr: "entry-server.ts",
          outDir: join(root, "server"),
        },
      });
      // Run the production bundle in a fresh process, avoiding mixed dev/prod
      // React module caches after Vite sets NODE_ENV for its browser build.
      const moduleURL = pathToFileURL(
        join(root, "server/entry-server.js"),
      ).href;
      const run = execute(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const {render}=await import(${JSON.stringify(moduleURL)});console.log(JSON.stringify(await Promise.all(['Alice','Bob'].map(render))));`,
        ],
        { env: { ...process.env, NODE_ENV: "production" } },
      );
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.deepEqual(
        JSON.parse(run.stdout),
        ["Alice", "Bob"].map((name) => ({
          html: `<p>${name}</p>`,
          requests: 1,
          hookRequests: 0,
        })),
      );
    }
    assert.equal(
      warnings.filter(
        (log) =>
          log.code === "MODULE_LEVEL_DIRECTIVE" &&
          (log.id?.includes("/sdk/") || log.message.includes("/sdk/")),
      ).length,
      0,
      JSON.stringify(warnings),
    );
  }
});

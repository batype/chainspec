import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { generateSDK } from "../lib/core/index.js";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { SWRConfig } from "swr";
import { build } from "vite";
const directory = await mkdtemp(join(process.cwd(), ".verify-environments-"));
const isolated = await mkdtemp(join(tmpdir(), "chainspec-node-"));
after(async () => {
  await Promise.all([
    rm(directory, { recursive: true, force: true }),
    rm(isolated, { recursive: true, force: true }),
  ]);
});
const fixture = {
  openapi: "3.0.3",
  info: {
    title: "Environment fixture",
    version: "1",
  },
  paths: {
    "/users/{id}": {
      get: {
        operationId: "getUser",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          200: {
            description: "User",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                    },
                    name: {
                      type: "string",
                    },
                  },
                  required: ["id", "name"],
                },
              },
            },
          },
        },
      },
    },
  },
};
const generated = generateSDK(fixture, { translateNames: false });
for (const [name, text] of Object.entries(generated.files)) {
  await writeFile(join(directory, name), text);
  await writeFile(join(isolated, name), text);
}
await writeFile(join(isolated, "package.json"), '{"type":"module"}');
const compile = (root, files, extra = []) => {
  const result = spawnSync(
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
      join(root, "compiled"),
      ...extra,
      ...files.map((file) => join(root, file)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
};
compile(
  directory,
  Object.keys(generated.files).filter((file) => file.endsWith(".ts")),
);
const node = await import(pathToFileURL(join(directory, "compiled/node.js")));
const react = await import(pathToFileURL(join(directory, "compiled/react.js")));
const endpoint = (api) => api.main.users.getUser;

test("Node entry compiles and executes without React, SWR or DOM globals; Hook methods absent in runtime and types", async () => {
  await writeFile(
    join(isolated, "contract.ts"),
    `import {createAPI} from './node.js';
const endpoint=createAPI().main.users.getUser;
// @ts-expect-error Universal endpoints never expose React Hooks.
endpoint.useRequest({path:{id:'one'}});
// @ts-expect-error Required path params remain checked.
endpoint.request({});
`,
  );
  compile(isolated, ["node.ts", "contract.ts"]);
  const buildNode = spawnSync(
    resolve("node_modules/.bin/tsc"),
    ["-p", join(isolated, "tsconfig.node.json")],
    { encoding: "utf8" },
  );
  assert.equal(buildNode.status, 0, buildNode.stdout + buildNode.stderr);
  await writeFile(
    join(isolated, "node-consumer.ts"),
    `import {createAPI} from './dist/node.js';
const API=createAPI({headers:{'X-User':'node'}});
const user:Promise<{id:string;name:string}>=API.main.users.getUser.request({path:{id:'42'}},{headers:new Headers({'X-Test':'yes'})});
`,
  );
  const nodeTypes = spawnSync(
    resolve("node_modules/.bin/tsc"),
    [
      "--ignoreConfig",
      "--strict",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2022",
      "--types",
      "node",
      "--typeRoots",
      resolve("node_modules/@types"),
      join(isolated, "node-consumer.ts"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(nodeTypes.status, 0, nodeTypes.stdout + nodeTypes.stderr);
  const compiledNode = await import(
    pathToFileURL(join(isolated, "dist/node.js"))
  );
  assert.equal(typeof compiledNode.createAPI, "function");
  const metadata = JSON.parse(generated.files["package.json"]);
  assert.equal(metadata.exports["./node"].import, "./dist/node.js");
  assert.equal(metadata.peerDependenciesMeta.react.optional, true);

  await writeFile(
    join(isolated, "run.mjs"),
    `import assert from 'node:assert/strict';import {createAPI} from './compiled/node.js';
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
for(const name of ['react','swr']){assert.throws(()=>import.meta.resolve(name));}
const api=createAPI({baseUrl:'https://example.test',request:async ctx=>({status:200,headers:new Headers(),data:{id:ctx.url,name:'Node'}})});
assert.equal('useRequest' in api.main.users.getUser,false);
assert.equal((await api.main.users.getUser.request({path:{id:'a b'}})).id,'https://example.test/users/a%20b');
console.log('isolated Node OK');`,
  );
  const run = spawnSync(process.execPath, [join(isolated, "run.mjs")], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /isolated Node OK/);
  const plain = generateSDK(fixture, { hooks: false });
  assert(plain.files["node.ts"]);
  assert.equal(plain.files["react.ts"], undefined);
  assert.equal(plain.files["hooks.ts"], undefined);
  assert(generated.files["react.ts"].startsWith('"use client";'));
  assert(generated.files["hooks.ts"].startsWith('"use client";'));
  for (const name of ["index.ts", "node.ts", "runtime.ts", "client.ts"])
    assert(!generated.files[name].includes('"use client"'));
});

test("injected Fetch retains serialization, decoding, signals and middleware; request adapter takes precedence", async () => {
  const calls = [],
    events = [],
    controller = new AbortController();
  const api = node.createAPI({
    baseUrl: "https://example.test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      events.push("fetch");
      return new Response(JSON.stringify({ id: "42", name: "Fetched" }), {
        headers: { "Content-Type": "application/json" },
      });
    },
    beforeRequest: [
      (ctx) => {
        events.push("before");
        ctx.headers.set("X-Test", "yes");
      },
    ],
    afterResponse: [
      () => {
        events.push("after");
      },
    ],
  });
  assert.deepEqual(
    await endpoint(api).request(
      { path: { id: "42" } },
      { signal: controller.signal },
    ),
    { id: "42", name: "Fetched" },
  );
  assert.equal(calls[0].url, "https://example.test/users/42");
  assert.equal(calls[0].init.headers.get("X-Test"), "yes");
  assert.equal(calls[0].init.signal, controller.signal);
  assert.deepEqual(events, ["before", "fetch", "after"]);
  const custom = node.createAPI({
    fetch: async () => {
      throw Error("must not run");
    },
    request: async () => ({
      status: 200,
      headers: new Headers(),
      data: { id: "1", name: "Adapter" },
    }),
  });
  assert.equal(
    (await endpoint(custom).request({ path: { id: "1" } })).name,
    "Adapter",
  );
  const reactAPI = react.createReactAPI({
    request: async () => ({
      status: 200,
      headers: new Headers(),
      data: { id: "r", name: "React request" },
    }),
  });
  assert.equal(
    (await endpoint(reactAPI).request({ path: { id: "r" } })).name,
    "React request",
  );
  assert.equal(typeof endpoint(reactAPI).useRequest, "function");
});

test("React SSR reads typed fallbackData without fetching during render and isolates each user tree", async () => {
  let requests = 0,
    hookRequests = 0;
  async function renderUser(id) {
    const api = node.createAPI({
      request: async (ctx) => {
        requests++;
        return {
          status: 200,
          headers: new Headers(),
          data: { id, name: ctx.headers.get("X-User") },
        };
      },
      headers: { "X-User": id },
    });
    const initial = await endpoint(api).request({ path: { id } });
    function View() {
      const [API] = React.useState(() =>
        react.createReactAPI({
          request: async () => {
            hookRequests++;
            throw Error("render must not fetch");
          },
        }),
      );
      const { data } = endpoint(API).useRequest(
        { path: { id } },
        { swr: { fallbackData: initial, revalidateOnMount: false } },
      );
      return React.createElement("p", null, data?.name);
    }
    return renderToString(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        React.createElement(View),
      ),
    );
  }
  const [alice, bob] = await Promise.all([
    renderUser("Alice"),
    renderUser("Bob"),
  ]);
  assert.equal(alice, "<p>Alice</p>");
  assert.equal(bob, "<p>Bob</p>");
  assert.equal(requests, 2);
  assert.equal(hookRequests, 0);
});

test("Vite builds server and browser entries from the same SDK; SSR module renders with independent fallback data", async () => {
  const source = `import * as React from 'react';import {renderToString} from 'react-dom/server';import {createAPI} from './node.js';import {createReactAPI} from './react.js';export async function render(name:string){const api=createAPI({request:async()=>({status:200,headers:new Headers(),data:{id:name,name}})});const initial=await api.main.users.getUser.request({path:{id:name}});function View(){const [API]=React.useState(()=>createReactAPI());const {data}=API.main.users.getUser.useRequest({path:{id:name}},{swr:{fallbackData:initial,revalidateOnMount:false}});return React.createElement('p',null,data?.name);}return renderToString(React.createElement(View));}`;
  await writeFile(join(directory, "entry-server.ts"), source);
  const ssrDirectory = join(directory, "ssr");
  await build({
    configFile: false,
    root: directory,
    logLevel: "silent",
    build: { ssr: "entry-server.ts", outDir: ssrDirectory, minify: false },
  });
  const server = await import(
    pathToFileURL(join(ssrDirectory, "entry-server.js"))
  );
  assert.equal(await server.render("Vite Alice"), "<p>Vite Alice</p>");
  assert.equal(await server.render("Vite Bob"), "<p>Vite Bob</p>");
  await writeFile(
    join(directory, "index.html"),
    '<div id="app"></div><script type="module" src="/entry-client.ts"></script>',
  );
  await writeFile(
    join(directory, "entry-client.ts"),
    `import * as React from 'react';import {createRoot} from 'react-dom/client';import {createReactAPI} from './react.js';const API=createReactAPI({baseUrl:'https://example.test'});function View(){const {data}=API.main.users.getUser.useRequest({path:{id:'browser'}},{enabled:false});return React.createElement('p',null,data?.name);}createRoot(document.getElementById('app')!).render(React.createElement(View));`,
  );
  await build({
    configFile: false,
    root: directory,
    logLevel: "silent",
    build: { outDir: join(directory, "browser") },
  });
});

test("environment examples select pure server entries or React client boundaries with compatible build paths", async () => {
  const result = spawnSync(
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
      join(directory, "preview"),
      "src/usage.ts",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { usage } = await import(
    pathToFileURL(join(directory, "preview/usage.js"))
  );
  const op = generated.operations[0];
  for (const environment of ["node", "next-server", "vite-ssr"]) {
    const code = usage(generated, op, "hook", environment);
    assert(!code.includes(".useRequest("));
    assert(code.includes("createAPI"));
    assert(!code.includes("createReactAPI"));
  }
  const nextServer = usage(generated, op, "hook", "next-server");
  assert(nextServer.includes("./sdk/dist/node.js"));
  assert(nextServer.includes("cache: 'no-store'"));
  assert(nextServer.includes("export async function loadData"));
  const client = usage(generated, op, "hook", "next-client");
  assert(client.includes('"use client";'));
  assert(client.includes("./sdk/dist/react.js"));
  assert(client.includes(".useRequest("));
  for (const environment of ["react", "universal"]) {
    const code = usage(generated, op, "hook", environment);
    assert(code.includes(".useRequest("));
    assert(!code.includes('"use client";'));
  }
  const clientRequest = usage(generated, op, "request", "next-client");
  assert(clientRequest.includes("createReactAPI"));
  assert(clientRequest.includes("export async function submit"));
  assert(!clientRequest.includes(".useRequest("));
});

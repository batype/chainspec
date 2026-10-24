import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { generateSDK, parseConfig, SDK_TARGETS } from "../lib/core/index.js";
const root = await mkdtemp(join(process.cwd(), ".verify-guide-"));
after(() => rm(root, { recursive: true, force: true }));
const tsc = resolve("node_modules/.bin/tsc");
function compile(args, cwd = process.cwd()) {
  const r = spawnSync(tsc, args, { cwd, encoding: "utf8" });
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
  join(root, "content"),
  "src/guide-content.ts",
  "src/example.ts",
]);
const {
  guideConfig,
  guideBuildCommand,
  guideIntegration,
  requestExample,
  hookExample,
} = await import(pathToFileURL(join(root, "content/guide-content.js")));
const { exampleText } = await import(
  pathToFileURL(join(root, "content/example.js"))
);
async function save(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

test("published guide configurations and copyable integration examples compile against the generated SDK for every target", async () => {
  for (const { value: target } of SDK_TARGETS) {
    const project = join(root, target);
    await save(
      join(project, "package.json"),
      '{"private":true,"type":"module"}',
    );
    const config = parseConfig(guideConfig(target));
    const generated = generateSDK(exampleText, config);
    for (const [name, source] of Object.entries(generated.files))
      await save(join(project, "src/api", name), source);
    // Execute the guide's actual TypeScript build arguments and outDir convention.
    compile(guideBuildCommand(target).split(" ").slice(2), project);
    const examples = guideIntegration(target);
    for (const { file, code } of examples)
      await save(join(project, file), code);
    const factory = target === "react" ? "createReactAPI" : "createAPI";
    const entry =
      target === "react"
        ? "api/react"
        : target === "browser"
          ? "api/index"
          : target === "vite-ssr"
            ? "api/node"
            : "api-build/node";
    const requestFile = join(project, "src/request-example.ts");
    await save(
      requestFile,
      `import {${factory}} from './${entry}.js';\nconst API=${factory}();\n${requestExample}`,
    );
    const files = [
      ...examples.map(({ file }) => join(project, file)),
      requestFile,
    ];
    if (target === "react") {
      const file = join(project, "src/ManualActions.tsx");
      await save(file, hookExample);
      files.push(file);
    }
    compile(
      [
        "--ignoreConfig",
        "--strict",
        "--skipLibCheck",
        "--noEmit",
        "--allowJs",
        "--checkJs",
        "--jsx",
        "react-jsx",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--lib",
        "ES2022,DOM,DOM.Iterable",
        ...files,
      ],
      project,
    );
  }
});

import { createServer } from "node:http";
import { readFile, lstat } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { resolve, dirname } from "node:path";
import { parseConfig, parseTranslationConfig, TranslationError } from "../lib/core/index.js";
import { createNodeTranslator } from "./translation-provider.mjs";

/** Loopback-only bridge for a static web page. Never accepts keys from the browser. */
export function createTranslationServer(translation, origin, translate = createNodeTranslator(translation)) {
  const config = parseTranslationConfig(translation);
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.url !== "/translate") { res.writeHead(404); res.end(); return; }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.headers["access-control-request-private-network"] === "true")
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204); res.end(); return;
    }
    if (req.method !== "POST" || !/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) {
      res.writeHead(415); res.end(); return;
    }
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    const reply = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    const chunks = [];
    try {
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) { reply(413, { error: "Request too large" }); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof value.text !== "string" || !value.text || Buffer.byteLength(value.text) > 500 || value.provider !== config.provider) {
        reply(400, { error: "Invalid group name or provider mismatch" }); return;
      }
      const translatedText = await translate(value.text, abort.signal);
      if (!abort.signal.aborted) reply(200, { translatedText });
    } catch (error) {
      if (abort.signal.aborted) return;
      reply(502, { error: error instanceof TranslationError ? error.message : "Translation failed" });
    }
  });
}

export async function runTranslationServer(args) {
  if (args.includes("--help")) {
    console.log("chainspec translate-server --config chainspec.config.json [--env-file .env] [--port 4190] [--origin https://batype.github.io]\nBinds only 127.0.0.1. Real API keys stay in the local environment.");
    return;
  }
  let configPath, envPath, port = 4190, origin = "https://batype.github.io";
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || !["--config", "--env-file", "--port", "--origin"].includes(flag)) throw Error("Use translate-server --config FILE [--env-file .env] [--port 4190] [--origin https://batype.github.io]");
    if (flag === "--config") configPath = resolve(value);
    else if (flag === "--env-file") envPath = resolve(value);
    else if (flag === "--port") port = Number(value);
    else origin = value;
  }
  if (!configPath) throw Error("translate-server requires --config");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Port must be 1024–65535");
  const url = new URL(origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("--origin must be a single HTTP(S) origin without a path");
  const stat = await lstat(configPath);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error("Invalid config file");
  const config = parseConfig(await readFile(configPath, "utf8"));
  if (envPath) loadEnvFile(envPath);
  else {
    try { loadEnvFile(resolve(dirname(configPath), ".env")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const server = createTranslationServer(config.translation ?? { provider: "mymemory" }, origin);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  console.log(`Translation proxy: http://127.0.0.1:${port}/translate\nAllowed origin: ${origin}\nProvider: ${config.translation?.provider ?? "mymemory"}\nKeys are read only from local environment variables. Press Ctrl+C to stop.`);
  return server;
}

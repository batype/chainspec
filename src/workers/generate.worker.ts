import { generateSDKAsync } from "../core/index";
import { inspectDocument } from "../editor-state";
let active: AbortController | undefined;
self.onmessage = async ({ data }) => {
  if (data.action === "inspect") {
    try { self.postMessage({kind:"inspection",id:data.id,info:inspectDocument(data.input)}); }
    catch(error) { self.postMessage({kind:"inspection",id:data.id,inspectionError:error instanceof Error?error.message:"无法识别文档"}); }
    return;
  }
  active?.abort();
  if (data.action === "cancel") return;
  const controller = new AbortController();
  active = controller;
  try {
    const result = await generateSDKAsync(data.input, data.options, {
      signal: controller.signal,
      onProgress: (progress) => self.postMessage({ id: data.id, progress }),
    });
    if (controller.signal.aborted) return;
    self.postMessage({
      id: data.id,
      result,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "生成失败",
    });
  }
};

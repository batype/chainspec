import { generateSDKAsync } from "../core/index";
let active: AbortController | undefined;
self.onmessage = async ({ data }) => {
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

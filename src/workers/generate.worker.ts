import { generateSDK } from "../core/index";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: generateSDK(data.input, data.options),
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "生成失败",
    });
  }
};

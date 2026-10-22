import type { TranslationConfig } from "../lib/core/index.js";
export declare function createNodeTranslator(config?: TranslationConfig, env?: Record<string, string | undefined>, transport?: typeof fetch): (text: string, signal?: AbortSignal) => Promise<string>;

export type Json = Record<string, any>;
export type Diagnostic = {
  level: "warning" | "error" | "info";
  code: string;
  message: string;
  location?: string;
};
export type GeneratorOptions = {
  namespace?: string;
  groupBy?: "path" | "tag";
  stripPrefix?: string;
  controllerNames?: Record<string, string>;
  baseUrl?: string;
  hooks?: boolean;
  translateNames?: boolean;
  translation?: TranslationConfig;
};
export type TranslationConfig = {
  provider: "mymemory" | "google" | "baidu" | "youdao";
  apiKeyEnv?: string;
  appIdEnv?: string;
  /** Browser-only proxy; CLI talks directly to the configured official provider. */
  proxyUrl?: string;
};
export type Parameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  style?: string;
  explode?: boolean;
  schema: unknown;
};
export type Operation = {
  id: string;
  method: string;
  path: string;
  controller: string;
  originalController: string;
  name: string;
  originalId?: string;
  tags: string[];
  summary: string;
  deprecated: boolean;
  parameters: Parameter[];
  body?: { schema: unknown; required: boolean; mediaType: string };
  response: unknown;
  responseType: "json" | "text" | "blob" | "void" | "auto";
  responseStatuses: string[];
  security: unknown;
};
export type GeneratedProject = {
  title: string;
  version: string;
  namespace: string;
  baseUrl: string;
  operations: Operation[];
  schemaCount: number;
  diagnostics: Diagnostic[];
  files: Record<string, string>;
  controllerNames: Record<string, string>;
};
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_OPERATIONS = 5000;

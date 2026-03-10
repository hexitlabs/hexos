import type { HexOSPluginApi } from "../../src/plugins/types.js";

import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: HexOSPluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}

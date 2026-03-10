import type { HexOSPluginApi } from "hexos/plugin-sdk";
import { emptyPluginConfigSchema } from "hexos/plugin-sdk";

import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: HexOSPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;

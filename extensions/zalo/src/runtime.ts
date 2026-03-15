import type { PluginRuntime } from "hexos/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setZaloRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getZaloRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Zalo runtime not initialized");
  }
  return runtime;
}

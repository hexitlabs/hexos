import { displayPath } from "../utils.js";
import { CONFIG_PATH_HEXOS } from "./paths.js";
export function formatConfigPath(path = CONFIG_PATH_HEXOS) {
    return displayPath(path);
}
export function logConfigUpdated(runtime, opts = {}) {
    const path = formatConfigPath(opts.path ?? CONFIG_PATH_HEXOS);
    const suffix = opts.suffix ? ` ${opts.suffix}` : "";
    runtime.log(`Updated ${path}${suffix}`);
}

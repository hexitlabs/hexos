import { isTruthyEnvValue } from "../infra/env.js";
export async function startBrowserControlServerIfEnabled() {
    if (isTruthyEnvValue(process.env.HEXOS_SKIP_BROWSER_CONTROL_SERVER))
        return null;
    // Lazy import: keeps startup fast, but still bundles for the embedded
    // gateway (bun --compile) via the static specifier path.
    const override = process.env.HEXOS_BROWSER_CONTROL_MODULE?.trim();
    const mod = override ? await import(override) : await import("../browser/server.js");
    await mod.startBrowserControlServerFromConfig();
    return { stop: mod.stopBrowserControlServer };
}

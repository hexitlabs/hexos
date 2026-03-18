import fs from "node:fs/promises";
import JSON5 from "json5";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../agents/workspace.js";
import { CONFIG_PATH_HEXOS, writeConfigFile } from "../config/config.js";
import { formatConfigPath, logConfigUpdated } from "../config/logging.js";
import { resolveSessionTranscriptsDir } from "../config/sessions.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
async function readConfigFileRaw() {
    try {
        const raw = await fs.readFile(CONFIG_PATH_HEXOS, "utf-8");
        const parsed = JSON5.parse(raw);
        if (parsed && typeof parsed === "object") {
            return { exists: true, parsed: parsed };
        }
        return { exists: true, parsed: {} };
    }
    catch {
        return { exists: false, parsed: {} };
    }
}
export async function setupCommand(opts, runtime = defaultRuntime) {
    const desiredWorkspace = typeof opts?.workspace === "string" && opts.workspace.trim()
        ? opts.workspace.trim()
        : undefined;
    const existingRaw = await readConfigFileRaw();
    const cfg = existingRaw.parsed;
    const defaults = cfg.agents?.defaults ?? {};
    const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
    // HexOS: bundle recommended free model so it always appears in catalog
    const bundledModels = cfg.models?.providers ?? {};
    if (!bundledModels["nvidia-nim"]) {
        bundledModels["nvidia-nim"] = {
            baseUrl: "https://integrate.api.nvidia.com/v1",
            api: "openai-completions",
            models: [
                {
                    id: "nvidia/nemotron-3-super-120b-a12b",
                    name: "Nemotron 3 Super 120B (Free)",
                    reasoning: true,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 262000,
                    maxTokens: 32768,
                },
            ],
        };
    }
    const next = {
        ...cfg,
        gateway: {
            ...cfg.gateway,
            mode: cfg.gateway?.mode ?? "local",
        },
        models: {
            ...cfg.models,
            providers: bundledModels,
        },
        agents: {
            ...cfg.agents,
            defaults: {
                ...defaults,
                workspace,
            },
        },
    };
    if (!existingRaw.exists || defaults.workspace !== workspace) {
        await writeConfigFile(next);
        if (!existingRaw.exists) {
            runtime.log(`Wrote ${formatConfigPath()}`);
        }
        else {
            logConfigUpdated(runtime, { suffix: "(set agents.defaults.workspace)" });
        }
    }
    else {
        runtime.log(`Config OK: ${formatConfigPath()}`);
    }
    const ws = await ensureAgentWorkspace({
        dir: workspace,
        ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap,
    });
    runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
    const sessionsDir = resolveSessionTranscriptsDir();
    await fs.mkdir(sessionsDir, { recursive: true });
    runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}

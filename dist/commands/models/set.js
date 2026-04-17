import { logConfigUpdated } from "../../config/logging.js";
import { applyOpenAICodexProviderConfig } from "../onboard-auth.config-core.js";
import { resolveModelTarget, updateConfig } from "./shared.js";
export async function modelsSetCommand(modelRaw, runtime) {
    const updated = await updateConfig((cfg) => {
        const resolved = resolveModelTarget({ raw: modelRaw, cfg });
        const key = `${resolved.provider}/${resolved.model}`;
        const nextCfg = resolved.provider === "openai-codex"
            ? applyOpenAICodexProviderConfig(cfg)
            : cfg;
        const nextModels = { ...nextCfg.agents?.defaults?.models };
        if (!nextModels[key])
            nextModels[key] = {};
        const existingModel = nextCfg.agents?.defaults?.model;
        return {
            ...nextCfg,
            agents: {
                ...nextCfg.agents,
                defaults: {
                    ...nextCfg.agents?.defaults,
                    model: {
                        ...(existingModel?.fallbacks ? { fallbacks: existingModel.fallbacks } : undefined),
                        primary: key,
                    },
                    models: nextModels,
                },
            },
        };
    });
    logConfigUpdated(runtime);
    runtime.log(`Default model: ${updated.agents?.defaults?.model?.primary ?? modelRaw}`);
}

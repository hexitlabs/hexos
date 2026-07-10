function normalizeProviderId(provider) {
    if (!provider)
        return "";
    const normalized = provider.trim().toLowerCase();
    if (normalized === "z.ai" || normalized === "z-ai")
        return "zai";
    return normalized;
}
export function isBinaryThinkingProvider(provider) {
    return normalizeProviderId(provider) === "zai";
}
export const XHIGH_MODEL_REFS = [
    "openai/gpt-5.4",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.2-codex",
    "openai-codex/gpt-5.1-codex",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-sonnet-4-6",
];
export const MAX_THINKING_MODEL_REFS = ["openai-codex/gpt-5.6-sol"];
export const ULTRA_THINKING_MODEL_REFS = ["openai-codex/gpt-5.6-sol"];
const XHIGH_MODEL_SET = new Set(XHIGH_MODEL_REFS.map((entry) => entry.toLowerCase()));
const XHIGH_MODEL_IDS = new Set(XHIGH_MODEL_REFS.map((entry) => entry.split("/")[1]?.toLowerCase()).filter((entry) => Boolean(entry)));
const MAX_THINKING_MODEL_SET = new Set(MAX_THINKING_MODEL_REFS.map((entry) => entry.toLowerCase()));
const MAX_THINKING_MODEL_IDS = new Set(MAX_THINKING_MODEL_REFS.map((entry) => entry.split("/")[1]?.toLowerCase()).filter((entry) => Boolean(entry)));
const ULTRA_THINKING_MODEL_SET = new Set(ULTRA_THINKING_MODEL_REFS.map((entry) => entry.toLowerCase()));
const ULTRA_THINKING_MODEL_IDS = new Set(ULTRA_THINKING_MODEL_REFS.map((entry) => entry.split("/")[1]?.toLowerCase()).filter((entry) => Boolean(entry)));
function matchesThinkingModel(provider, model, refs, ids) {
    const modelKey = model?.trim().toLowerCase();
    if (!modelKey)
        return false;
    const providerKey = provider?.trim().toLowerCase();
    return providerKey ? refs.has(`${providerKey}/${modelKey}`) : ids.has(modelKey);
}
// Normalize user-provided thinking level strings to the canonical enum.
export function normalizeThinkLevel(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "none"].includes(key))
        return "off";
    if (["on", "enable", "enabled"].includes(key))
        return "low";
    if (["min", "minimal"].includes(key))
        return "minimal";
    if (["low", "thinkhard", "think-hard", "think_hard"].includes(key))
        return "low";
    if (["mid", "med", "medium", "thinkharder", "think-harder", "harder"].includes(key))
        return "medium";
    if (["high", "ultrathink", "think-hard", "thinkhardest", "highest"].includes(key))
        return "high";
    if (["xhigh", "x-high", "x_high", "uncapped"].includes(key))
        return "xhigh";
    if (["max", "maximum"].includes(key))
        return "max";
    if (["ultra"].includes(key))
        return "ultra";
    if (["think"].includes(key))
        return "minimal";
    return undefined;
}
export function supportsXHighThinking(provider, model) {
    return matchesThinkingModel(provider, model, XHIGH_MODEL_SET, XHIGH_MODEL_IDS);
}
export function supportsMaxThinking(provider, model) {
    return matchesThinkingModel(provider, model, MAX_THINKING_MODEL_SET, MAX_THINKING_MODEL_IDS);
}
export function supportsUltraThinking(provider, model) {
    return matchesThinkingModel(provider, model, ULTRA_THINKING_MODEL_SET, ULTRA_THINKING_MODEL_IDS);
}
export function supportsThinkingLevel(provider, model, level) {
    if (level === "xhigh")
        return supportsXHighThinking(provider, model);
    if (level === "max")
        return supportsMaxThinking(provider, model);
    if (level === "ultra")
        return supportsUltraThinking(provider, model);
    if (level === "minimal" && supportsMaxThinking(provider, model))
        return false;
    return ["off", "minimal", "low", "medium", "high"].includes(level);
}
export function listThinkingLevels(provider, model) {
    const levels = supportsMaxThinking(provider, model)
        ? ["off", "low", "medium", "high"]
        : ["off", "minimal", "low", "medium", "high"];
    if (supportsXHighThinking(provider, model))
        levels.push("xhigh");
    if (supportsMaxThinking(provider, model))
        levels.push("max");
    if (supportsUltraThinking(provider, model))
        levels.push("ultra");
    return levels;
}
export function listThinkingLevelLabels(provider, model) {
    if (isBinaryThinkingProvider(provider))
        return ["off", "on"];
    return listThinkingLevels(provider, model);
}
export function formatThinkingLevels(provider, model, separator = ", ") {
    return listThinkingLevelLabels(provider, model).join(separator);
}
export function formatXHighModelHint() {
    return formatThinkingLevelModelHint("xhigh");
}
export function formatThinkingLevelModelHint(level) {
    const refs = level === "max"
        ? [...MAX_THINKING_MODEL_REFS]
        : level === "ultra"
            ? [...ULTRA_THINKING_MODEL_REFS]
            : [...XHIGH_MODEL_REFS];
    if (refs.length === 0)
        return "unknown model";
    if (refs.length === 1)
        return refs[0];
    if (refs.length === 2)
        return `${refs[0]} or ${refs[1]}`;
    return `${refs.slice(0, -1).join(", ")} or ${refs[refs.length - 1]}`;
}
// Normalize verbose flags used to toggle agent verbosity.
export function normalizeVerboseLevel(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0"].includes(key))
        return "off";
    if (["full", "all", "everything"].includes(key))
        return "full";
    if (["on", "minimal", "true", "yes", "1"].includes(key))
        return "on";
    return undefined;
}
// Normalize system notice flags used to toggle system notifications.
export function normalizeNoticeLevel(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0"].includes(key))
        return "off";
    if (["full", "all", "everything"].includes(key))
        return "full";
    if (["on", "minimal", "true", "yes", "1"].includes(key))
        return "on";
    return undefined;
}
// Normalize response-usage display modes used to toggle per-response usage footers.
export function normalizeUsageDisplay(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0", "disable", "disabled"].includes(key))
        return "off";
    if (["on", "true", "yes", "1", "enable", "enabled"].includes(key))
        return "tokens";
    if (["tokens", "token", "tok", "minimal", "min"].includes(key))
        return "tokens";
    if (["full", "session"].includes(key))
        return "full";
    return undefined;
}
export function resolveResponseUsageMode(raw) {
    return normalizeUsageDisplay(raw) ?? "off";
}
// Normalize elevated flags used to toggle elevated bash permissions.
export function normalizeElevatedLevel(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0"].includes(key))
        return "off";
    if (["full", "auto", "auto-approve", "autoapprove"].includes(key))
        return "full";
    if (["ask", "prompt", "approval", "approve"].includes(key))
        return "ask";
    if (["on", "true", "yes", "1"].includes(key))
        return "on";
    return undefined;
}
export function resolveElevatedMode(level) {
    if (!level || level === "off")
        return "off";
    if (level === "full")
        return "full";
    return "ask";
}
// Normalize reasoning visibility flags used to toggle reasoning exposure.
export function normalizeReasoningLevel(raw) {
    if (!raw)
        return undefined;
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0", "hide", "hidden", "disable", "disabled"].includes(key))
        return "off";
    if (["on", "true", "yes", "1", "show", "visible", "enable", "enabled"].includes(key))
        return "on";
    if (["stream", "streaming", "draft", "live"].includes(key))
        return "stream";
    return undefined;
}

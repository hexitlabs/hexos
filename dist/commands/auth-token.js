import { normalizeProviderId } from "../agents/model-selection.js";
export const ANTHROPIC_SETUP_TOKEN_PREFIX = "";
export const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;
export const DEFAULT_TOKEN_PROFILE_NAME = "default";
export function normalizeTokenProfileName(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return DEFAULT_TOKEN_PROFILE_NAME;
    const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || DEFAULT_TOKEN_PROFILE_NAME;
}
export function buildTokenProfileId(params) {
    const provider = normalizeProviderId(params.provider);
    const name = normalizeTokenProfileName(params.name);
    return `${provider}:${name}`;
}
export function validateAnthropicSetupToken(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return "Required";
    if (trimmed.length < 20) {
        return "Token looks too short; paste the full token";
    }
    return undefined;
}

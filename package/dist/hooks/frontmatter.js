import JSON5 from "json5";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { parseBooleanValue } from "../utils/boolean.js";
export function parseFrontmatter(content) {
    return parseFrontmatterBlock(content);
}
function normalizeStringList(input) {
    if (!input)
        return [];
    if (Array.isArray(input)) {
        return input.map((value) => String(value).trim()).filter(Boolean);
    }
    if (typeof input === "string") {
        return input
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [];
}
function parseInstallSpec(input) {
    if (!input || typeof input !== "object")
        return undefined;
    const raw = input;
    const kindRaw = typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
    const kind = kindRaw.trim().toLowerCase();
    if (kind !== "bundled" && kind !== "npm" && kind !== "git") {
        return undefined;
    }
    const spec = {
        kind: kind,
    };
    if (typeof raw.id === "string")
        spec.id = raw.id;
    if (typeof raw.label === "string")
        spec.label = raw.label;
    const bins = normalizeStringList(raw.bins);
    if (bins.length > 0)
        spec.bins = bins;
    if (typeof raw.package === "string")
        spec.package = raw.package;
    if (typeof raw.repository === "string")
        spec.repository = raw.repository;
    return spec;
}
function getFrontmatterValue(frontmatter, key) {
    const raw = frontmatter[key];
    return typeof raw === "string" ? raw : undefined;
}
function parseFrontmatterBool(value, fallback) {
    const parsed = parseBooleanValue(value);
    return parsed === undefined ? fallback : parsed;
}
export function resolveHexOSMetadata(frontmatter) {
    const raw = getFrontmatterValue(frontmatter, "metadata");
    if (!raw)
        return undefined;
    try {
        const parsed = JSON5.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return undefined;
        const hexos = parsed.hexos;
        if (!hexos || typeof hexos !== "object")
            return undefined;
        const hexosObj = hexos;
        const requiresRaw = typeof hexosObj.requires === "object" && hexosObj.requires !== null
            ? hexosObj.requires
            : undefined;
        const installRaw = Array.isArray(hexosObj.install) ? hexosObj.install : [];
        const install = installRaw
            .map((entry) => parseInstallSpec(entry))
            .filter((entry) => Boolean(entry));
        const osRaw = normalizeStringList(hexosObj.os);
        const eventsRaw = normalizeStringList(hexosObj.events);
        return {
            always: typeof hexosObj.always === "boolean" ? hexosObj.always : undefined,
            emoji: typeof hexosObj.emoji === "string" ? hexosObj.emoji : undefined,
            homepage: typeof hexosObj.homepage === "string" ? hexosObj.homepage : undefined,
            hookKey: typeof hexosObj.hookKey === "string" ? hexosObj.hookKey : undefined,
            export: typeof hexosObj.export === "string" ? hexosObj.export : undefined,
            os: osRaw.length > 0 ? osRaw : undefined,
            events: eventsRaw.length > 0 ? eventsRaw : [],
            requires: requiresRaw
                ? {
                    bins: normalizeStringList(requiresRaw.bins),
                    anyBins: normalizeStringList(requiresRaw.anyBins),
                    env: normalizeStringList(requiresRaw.env),
                    config: normalizeStringList(requiresRaw.config),
                }
                : undefined,
            install: install.length > 0 ? install : undefined,
        };
    }
    catch {
        return undefined;
    }
}
export function resolveHookInvocationPolicy(frontmatter) {
    return {
        enabled: parseFrontmatterBool(getFrontmatterValue(frontmatter, "enabled"), true),
    };
}
export function resolveHookKey(hookName, entry) {
    return entry?.hexos?.hookKey ?? hookName;
}

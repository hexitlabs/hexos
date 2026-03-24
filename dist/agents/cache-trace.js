import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { resolveUserPath } from "../utils.js";
const writers = new Map();
const REDACTED_IMAGE_DATA = "<redacted>";
const NON_CREDENTIAL_FIELD_NAMES = new Set([
    "passwordfile",
    "tokenbudget",
    "tokencount",
    "tokenfield",
    "tokenlimit",
    "tokens",
]);
function toLowerTrimmed(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function normalizeFieldName(value) {
    return value.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}
function isCredentialFieldName(key) {
    const normalized = normalizeFieldName(key);
    if (!normalized || NON_CREDENTIAL_FIELD_NAMES.has(normalized))
        return false;
    if (normalized === "authorization" || normalized === "proxyauthorization")
        return true;
    return (normalized.endsWith("apikey") ||
        normalized.endsWith("password") ||
        normalized.endsWith("passwd") ||
        normalized.endsWith("passphrase") ||
        normalized.endsWith("secret") ||
        normalized.endsWith("secretkey") ||
        normalized.endsWith("token"));
}
function hasImageMime(record) {
    return [
        toLowerTrimmed(record.mimeType),
        toLowerTrimmed(record.media_type),
        toLowerTrimmed(record.mime_type),
    ].some((value) => value.startsWith("image/"));
}
function shouldRedactImageData(record) {
    if (typeof record.data !== "string")
        return false;
    return toLowerTrimmed(record.type) === "image" || hasImageMime(record);
}
function digestBase64Payload(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}
function estimateBase64DecodedBytes(data) {
    if (typeof data !== "string")
        return 0;
    return Math.floor((data.length * 3) / 4);
}
/**
 * Removes credential-like fields and image/base64 payload data from diagnostic
 * objects before persistence.
 */
function sanitizeDiagnosticPayload(value) {
    const seen = new WeakSet();
    const visit = (input) => {
        if (Array.isArray(input))
            return input.map((entry) => visit(entry));
        if (!input || typeof input !== "object")
            return input;
        if (seen.has(input))
            return "[Circular]";
        seen.add(input);
        const record = input;
        const out = {};
        for (const [key, val] of Object.entries(record)) {
            if (isCredentialFieldName(key))
                continue;
            out[key] = visit(val);
        }
        if (shouldRedactImageData(record)) {
            out.data = REDACTED_IMAGE_DATA;
            out.bytes = estimateBase64DecodedBytes(record.data);
            out.sha256 = digestBase64Payload(record.data);
        }
        return out;
    };
    return visit(value);
}
function resolveCacheTraceConfig(params) {
    const env = params.env ?? process.env;
    const config = params.cfg?.diagnostics?.cacheTrace;
    const envEnabled = parseBooleanValue(env.HEXOS_CACHE_TRACE);
    const enabled = envEnabled ?? config?.enabled ?? false;
    const fileOverride = config?.filePath?.trim() || env.HEXOS_CACHE_TRACE_FILE?.trim();
    const filePath = fileOverride
        ? resolveUserPath(fileOverride)
        : path.join(resolveStateDir(env), "logs", "cache-trace.jsonl");
    const includeMessages = parseBooleanValue(env.HEXOS_CACHE_TRACE_MESSAGES) ?? config?.includeMessages;
    const includePrompt = parseBooleanValue(env.HEXOS_CACHE_TRACE_PROMPT) ?? config?.includePrompt;
    const includeSystem = parseBooleanValue(env.HEXOS_CACHE_TRACE_SYSTEM) ?? config?.includeSystem;
    return {
        enabled,
        filePath,
        includeMessages: includeMessages ?? true,
        includePrompt: includePrompt ?? true,
        includeSystem: includeSystem ?? true,
    };
}
function getWriter(filePath) {
    const existing = writers.get(filePath);
    if (existing)
        return existing;
    const dir = path.dirname(filePath);
    const ready = fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    let queue = Promise.resolve();
    const writer = {
        filePath,
        write: (line) => {
            queue = queue
                .then(() => ready)
                .then(() => fs.appendFile(filePath, line, "utf8"))
                .catch(() => undefined);
        },
    };
    writers.set(filePath, writer);
    return writer;
}
function stableStringify(value) {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value === "number" && !Number.isFinite(value))
        return JSON.stringify(String(value));
    if (typeof value === "bigint")
        return JSON.stringify(value.toString());
    if (typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (value instanceof Error) {
        return stableStringify({
            name: value.name,
            message: value.message,
            stack: value.stack,
        });
    }
    if (value instanceof Uint8Array) {
        return stableStringify({
            type: "Uint8Array",
            data: Buffer.from(value).toString("base64"),
        });
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }
    const record = value;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
}
function digest(value) {
    const serialized = stableStringify(value);
    return crypto.createHash("sha256").update(serialized).digest("hex");
}
function summarizeMessages(messages) {
    const messageFingerprints = messages.map((msg) => digest(msg));
    return {
        messageCount: messages.length,
        messageRoles: messages.map((msg) => msg.role),
        messageFingerprints,
        messagesDigest: digest(messageFingerprints.join("|")),
    };
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value, (_key, val) => {
            if (typeof val === "bigint")
                return val.toString();
            if (typeof val === "function")
                return "[Function]";
            if (val instanceof Error) {
                return { name: val.name, message: val.message, stack: val.stack };
            }
            if (val instanceof Uint8Array) {
                return { type: "Uint8Array", data: Buffer.from(val).toString("base64") };
            }
            return val;
        });
    }
    catch {
        return null;
    }
}
export function createCacheTrace(params) {
    const cfg = resolveCacheTraceConfig(params);
    if (!cfg.enabled)
        return null;
    const writer = params.writer ?? getWriter(cfg.filePath);
    let seq = 0;
    const base = {
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.modelApi,
        workspaceDir: params.workspaceDir,
    };
    const recordStage = (stage, payload = {}) => {
        const event = {
            ...base,
            ts: new Date().toISOString(),
            seq: (seq += 1),
            stage,
        };
        if (payload.prompt !== undefined && cfg.includePrompt) {
            event.prompt = payload.prompt;
        }
        if (payload.system !== undefined && cfg.includeSystem) {
            event.system = sanitizeDiagnosticPayload(payload.system);
            event.systemDigest = digest(payload.system);
        }
        if (payload.options)
            event.options = sanitizeDiagnosticPayload(payload.options);
        if (payload.model)
            event.model = sanitizeDiagnosticPayload(payload.model);
        const messages = payload.messages;
        if (Array.isArray(messages)) {
            const summary = summarizeMessages(messages);
            event.messageCount = summary.messageCount;
            event.messageRoles = summary.messageRoles;
            event.messageFingerprints = summary.messageFingerprints;
            event.messagesDigest = summary.messagesDigest;
            if (cfg.includeMessages) {
                event.messages = sanitizeDiagnosticPayload(messages);
            }
        }
        if (payload.note)
            event.note = payload.note;
        if (payload.error)
            event.error = payload.error;
        const line = safeJsonStringify(event);
        if (!line)
            return;
        writer.write(`${line}\n`);
    };
    const wrapStreamFn = (streamFn) => {
        const wrapped = (model, context, options) => {
            recordStage("stream:context", {
                model: {
                    id: model?.id,
                    provider: model?.provider,
                    api: model?.api,
                },
                system: context.system,
                messages: context.messages ?? [],
                options: (options ?? {}),
            });
            return streamFn(model, context, options);
        };
        return wrapped;
    };
    return {
        enabled: true,
        filePath: cfg.filePath,
        recordStage,
        wrapStreamFn,
    };
}

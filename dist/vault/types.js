/**
 * HexOS Vault — Type definitions and constants.
 *
 * Provides the foundational types for the encrypted credential vault.
 */

/** Vault file format version */
export const VAULT_VERSION = 1;

/** Default vault file path */
export const DEFAULT_VAULT_PATH = undefined; // resolved dynamically via resolveVaultPath()

/** Vault reference prefix used in config */
export const VAULT_REF_PREFIX = "$vault:";

/** Known secret patterns for migration auto-detection */
export const SECRET_FIELD_NAMES = new Set([
  "apiKey",
  "botToken",
  "token",
  "secret",
  "password",
  "privateKey",
  "appSecret",
  "webhookSecret",
  "signingSecret",
  "accessToken",
  "refreshToken",
]);

/** Known secret value patterns (regex strings) */
export const SECRET_VALUE_PATTERNS = [
  // Anthropic
  { pattern: /^sk-ant-[a-zA-Z0-9-]{20,}/, provider: "anthropic" },
  // OpenAI
  { pattern: /^sk-[a-zA-Z0-9]{20,}/, provider: "openai" },
  // GitHub
  { pattern: /^ghp_[a-zA-Z0-9]{36,}/, provider: "github" },
  { pattern: /^gho_[a-zA-Z0-9]{36,}/, provider: "github" },
  { pattern: /^github_pat_[a-zA-Z0-9_]{20,}/, provider: "github" },
  // Brave Search
  { pattern: /^BSA[a-zA-Z0-9]{20,}/, provider: "brave" },
  // NVIDIA NIM
  { pattern: /^nvapi-[a-zA-Z0-9-]{20,}/, provider: "nvidia" },
  // Telegram bot tokens
  { pattern: /^\d{8,}:[A-Za-z0-9_-]{30,}/, provider: "telegram" },
  // AWS
  { pattern: /^AKIA[A-Z0-9]{16}/, provider: "aws" },
  // Generic high-entropy (fallback)
];

/** Leak detection patterns for scanning */
export const LEAK_PATTERNS = [
  { name: "anthropic_key", regex: /sk-ant-[a-zA-Z0-9-]{20,}/g },
  { name: "openai_key", regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "aws_key", regex: /AKIA[A-Z0-9]{16}/g },
  { name: "jwt", regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/g },
  { name: "private_key", regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
  { name: "bot_token", regex: /\d{8,}:[A-Za-z0-9_-]{30,}/g },
  { name: "github_pat", regex: /ghp_[a-zA-Z0-9]{36,}/g },
  { name: "github_oauth", regex: /gho_[a-zA-Z0-9]{36,}/g },
  { name: "nvidia_key", regex: /nvapi-[a-zA-Z0-9-]{20,}/g },
];

/** Known provider endpoint mappings for auto-allowlisting during migration */
export const PROVIDER_ENDPOINTS = {
  anthropic: ["https://api.anthropic.com/*"],
  openai: ["https://api.openai.com/*"],
  brave: ["https://api.search.brave.com/*"],
  nvidia: ["https://integrate.api.nvidia.com/*"],
  telegram: ["https://api.telegram.org/*"],
  github: ["https://api.github.com/*"],
  aws: ["https://*.amazonaws.com/*"],
};

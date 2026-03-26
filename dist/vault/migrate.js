/**
 * HexOS Vault — Migration.
 *
 * Scans hexos.json for plaintext secrets and migrates them to the vault.
 * Replaces inline values with $vault:NAME references.
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, readConfigFileSnapshot, resolveConfigPath } from "../config/config.js";
import { setSecret, loadVault } from "./store.js";
import { logVaultEvent } from "./audit.js";
import {
  SECRET_FIELD_NAMES,
  SECRET_VALUE_PATTERNS,
  VAULT_REF_PREFIX,
  PROVIDER_ENDPOINTS,
} from "./types.js";

/**
 * Generate a vault secret name from a config path.
 * e.g., "models.providers.anthropic.apiKey" → "ANTHROPIC_APIKEY"
 */
function generateVaultName(configPath) {
  const parts = configPath.split(".");

  // Try to find a meaningful provider/service name
  // Common paths:
  //   models.providers.anthropic.apiKey → ANTHROPIC_APIKEY
  //   tools.web.search.apiKey → WEB_SEARCH_APIKEY
  //   channels.telegram.botToken → TELEGRAM_BOTTOKEN

  const fieldName = parts[parts.length - 1];
  const contextParts = parts.slice(0, -1);

  // Remove generic path segments
  const filteredParts = contextParts.filter(
    (p) => !["models", "providers", "tools", "channels", "config"].includes(p)
  );

  const meaningfulParts = filteredParts.length > 0 ? filteredParts : contextParts.slice(-1);

  const name = [...meaningfulParts, fieldName]
    .map((p) =>
      p
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_")
    )
    .join("_");

  return name;
}

/**
 * Detect the provider from a secret value for endpoint allowlisting.
 */
function detectProvider(value) {
  for (const { pattern, provider } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return provider;
    }
  }
  return null;
}

/**
 * Check if a value looks like a secret (not already a vault ref, not a URL, etc.).
 */
function looksLikeSecret(fieldName, value) {
  if (typeof value !== "string") return false;
  if (value.startsWith(VAULT_REF_PREFIX)) return false;
  if (value.startsWith("${")) return false; // env var reference
  if (value.length < 8) return false;

  // Check field name
  if (SECRET_FIELD_NAMES.has(fieldName)) return true;

  // Check value patterns
  for (const { pattern } of SECRET_VALUE_PATTERNS) {
    // Reset regex lastIndex for patterns with /g flag
    if (pattern.lastIndex !== undefined) pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }

  return false;
}

/**
 * Recursively scan a config object for secrets.
 * Returns array of { path, fieldName, value, vaultName, provider }.
 */
function scanForSecrets(obj, currentPath = "") {
  const secrets = [];

  if (!obj || typeof obj !== "object") return secrets;

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key;

    if (typeof value === "string" && looksLikeSecret(key, value)) {
      const vaultName = generateVaultName(fullPath);
      const provider = detectProvider(value);

      secrets.push({
        path: fullPath,
        fieldName: key,
        value,
        vaultName,
        provider,
        allowedEndpoints: provider ? PROVIDER_ENDPOINTS[provider] ?? [] : [],
      });
    } else if (typeof value === "object" && value !== null) {
      secrets.push(...scanForSecrets(value, fullPath));
    }
  }

  return secrets;
}

/**
 * Set a value at a nested path in an object.
 */
function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Perform a dry-run migration scan.
 * Returns the list of secrets that would be migrated.
 */
export function scanConfigForMigration() {
  const cfg = loadConfig();
  return scanForSecrets(cfg);
}

/**
 * Migrate secrets from hexos.json to the vault.
 *
 * 1. Scan config for plaintext secrets
 * 2. Store each in vault with appropriate metadata
 * 3. Replace in config with $vault:NAME references
 * 4. Back up original config
 * 5. Write updated config
 */
export function migrateConfigSecrets(options = {}) {
  const configPath = resolveConfigPath();
  const snapshot = readConfigFileSnapshot();

  if (!snapshot.raw) {
    throw new Error("No config file found to migrate");
  }

  // Parse the raw config (we need the original structure, not the resolved one)
  let rawConfig;
  try {
    // Use JSON5 if available, fall back to JSON
    const JSON5 = await import("json5").then((m) => m.default).catch(() => JSON);
    rawConfig = JSON5.parse(snapshot.raw);
  } catch {
    rawConfig = JSON.parse(snapshot.raw);
  }

  const secrets = scanForSecrets(rawConfig);

  if (secrets.length === 0) {
    return { migrated: 0, secrets: [] };
  }

  if (options.dryRun) {
    return { migrated: secrets.length, secrets, dryRun: true };
  }

  // Back up original config
  const backupPath = `${configPath}.pre-vault`;
  fs.copyFileSync(configPath, backupPath);

  // Store each secret in vault and update config
  const migrated = [];
  for (const secret of secrets) {
    // Check if already in vault
    const vault = loadVault();
    if (vault.secrets[secret.vaultName]) {
      if (!options.overwrite) {
        continue; // Skip if already exists
      }
    }

    // Store in vault
    setSecret(secret.vaultName, secret.value, {
      usedBy: [secret.path],
      tags: secret.provider ? [secret.provider] : [],
      allowedEndpoints: secret.allowedEndpoints,
    });

    // Replace in config
    setNestedValue(rawConfig, secret.path, `${VAULT_REF_PREFIX}${secret.vaultName}`);
    migrated.push(secret);
  }

  // Write updated config
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2), {
    mode: 0o600,
  });

  logVaultEvent({
    event: "vault.migration",
    action: "migrated",
    secretCount: migrated.length,
    secrets: migrated.map((s) => s.vaultName),
    backupPath,
  });

  return { migrated: migrated.length, secrets: migrated, backupPath };
}

// Make migrateConfigSecrets work with dynamic import by handling async
// The actual async version
export async function migrateConfigSecretsAsync(options = {}) {
  const configPath = resolveConfigPath();

  let rawContent;
  try {
    rawContent = fs.readFileSync(configPath, "utf8");
  } catch {
    throw new Error("No config file found to migrate");
  }

  let rawConfig;
  try {
    const JSON5 = (await import("json5")).default;
    rawConfig = JSON5.parse(rawContent);
  } catch {
    rawConfig = JSON.parse(rawContent);
  }

  const secrets = scanForSecrets(rawConfig);

  if (secrets.length === 0) {
    return { migrated: 0, secrets: [] };
  }

  if (options.dryRun) {
    return { migrated: secrets.length, secrets, dryRun: true };
  }

  // Back up original config
  const backupPath = `${configPath}.pre-vault`;
  fs.copyFileSync(configPath, backupPath);

  // Store each secret in vault and update config
  const migrated = [];
  for (const secret of secrets) {
    const vault = loadVault();
    if (vault.secrets[secret.vaultName] && !options.overwrite) {
      continue;
    }

    setSecret(secret.vaultName, secret.value, {
      usedBy: [secret.path],
      tags: secret.provider ? [secret.provider] : [],
      allowedEndpoints: secret.allowedEndpoints,
    });

    setNestedValue(rawConfig, secret.path, `${VAULT_REF_PREFIX}${secret.vaultName}`);
    migrated.push(secret);
  }

  // Write updated config
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2), {
    mode: 0o600,
  });

  logVaultEvent({
    event: "vault.migration",
    action: "migrated",
    secretCount: migrated.length,
    secrets: migrated.map((s) => s.vaultName),
    backupPath,
  });

  return { migrated: migrated.length, secrets: migrated, backupPath };
}

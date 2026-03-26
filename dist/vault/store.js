/**
 * HexOS Vault — Storage layer.
 *
 * Manages the encrypted vault file (~/.hexos/vault.enc).
 * Provides CRUD operations for secrets with automatic encryption/decryption.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deriveVaultKey,
  encryptVault,
  decryptVault,
  loadDevicePrivateKey,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from "./crypto.js";
import { logVaultEvent } from "./audit.js";
import { VAULT_VERSION, VAULT_REF_PREFIX } from "./types.js";

const STATE_DIR = path.join(os.homedir(), ".hexos");

export function resolveVaultPath() {
  return path.join(STATE_DIR, "vault.enc");
}

/**
 * In-memory vault cache. Holds decrypted secrets while gateway is running.
 * Cleared on process exit.
 */
let memoryCache = null;
let vaultKey = null;

/**
 * Get or derive the vault encryption key.
 */
function getVaultKey() {
  if (vaultKey) return vaultKey;
  const privateKey = loadDevicePrivateKey();
  vaultKey = deriveVaultKey(privateKey);
  return vaultKey;
}

/**
 * Create empty vault data structure.
 */
function createEmptyVault() {
  return {
    version: VAULT_VERSION,
    secrets: {},
    metadata: {
      lastAccessed: new Date().toISOString(),
      secretCount: 0,
    },
  };
}

/**
 * Load vault from disk, decrypting it.
 */
export function loadVault() {
  if (memoryCache) return memoryCache;

  const vaultPath = resolveVaultPath();
  const key = getVaultKey();

  if (!fs.existsSync(vaultPath)) {
    memoryCache = createEmptyVault();
    return memoryCache;
  }

  try {
    const raw = fs.readFileSync(vaultPath, "utf8");
    const encryptedData = JSON.parse(raw);
    memoryCache = decryptVault(encryptedData, key);
    memoryCache.metadata.lastAccessed = new Date().toISOString();
    return memoryCache;
  } catch (err) {
    throw new Error(`Failed to decrypt vault: ${err.message}. The vault may be corrupted or the device key may have changed.`);
  }
}

/**
 * Save vault to disk, encrypting it.
 */
export function saveVault(vault) {
  const vaultPath = resolveVaultPath();
  const key = getVaultKey();

  // Ensure directory exists
  const dir = path.dirname(vaultPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  vault.metadata.secretCount = Object.keys(vault.secrets).length;
  vault.metadata.lastAccessed = new Date().toISOString();

  const encrypted = encryptVault(vault, key);
  fs.writeFileSync(vaultPath, JSON.stringify(encrypted, null, 2), {
    mode: 0o600,
  });

  // Update memory cache
  memoryCache = vault;
}

/**
 * Clear the in-memory vault cache (for gateway shutdown).
 */
export function clearVaultCache() {
  memoryCache = null;
  vaultKey = null;
}

/**
 * Set a secret in the vault.
 */
export function setSecret(name, value, options = {}) {
  const vault = loadVault();
  const now = new Date().toISOString();
  const existing = vault.secrets[name];

  vault.secrets[name] = {
    value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    usedBy: options.usedBy ?? existing?.usedBy ?? [],
    tags: options.tags ?? existing?.tags ?? [],
    allowedEndpoints: options.allowedEndpoints ?? existing?.allowedEndpoints ?? [],
  };

  saveVault(vault);

  logVaultEvent({
    event: existing ? "vault.update" : "vault.set",
    secret: name,
    action: existing ? "updated" : "created",
  });

  return vault.secrets[name];
}

/**
 * Get a secret value from the vault.
 */
export function getSecret(name, options = {}) {
  const vault = loadVault();
  const secret = vault.secrets[name];

  if (!secret) return null;

  if (options.logAccess !== false) {
    logVaultEvent({
      event: "vault.access",
      secret: name,
      action: "read",
      tool: options.tool,
      endpoint: options.endpoint,
    });
  }

  return secret;
}

/**
 * List all secrets (values redacted).
 */
export function listSecrets() {
  const vault = loadVault();
  const result = {};

  for (const [name, secret] of Object.entries(vault.secrets)) {
    result[name] = {
      redactedValue: redactValue(secret.value),
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      usedBy: secret.usedBy,
      tags: secret.tags,
      allowedEndpoints: secret.allowedEndpoints,
    };
  }

  return result;
}

/**
 * Remove a secret from the vault.
 */
export function removeSecret(name) {
  const vault = loadVault();

  if (!vault.secrets[name]) {
    return false;
  }

  delete vault.secrets[name];
  saveVault(vault);

  logVaultEvent({
    event: "vault.remove",
    secret: name,
    action: "removed",
  });

  return true;
}

/**
 * Rotate a secret (update value, log rotation event).
 */
export function rotateSecret(name, newValue) {
  const vault = loadVault();
  const existing = vault.secrets[name];

  if (!existing) {
    throw new Error(`Secret "${name}" not found in vault`);
  }

  const now = new Date().toISOString();
  vault.secrets[name] = {
    ...existing,
    value: newValue,
    updatedAt: now,
  };

  saveVault(vault);

  logVaultEvent({
    event: "vault.rotation",
    secret: name,
    action: "rotated",
  });

  return vault.secrets[name];
}

/**
 * Get all decrypted secret values (for leak detection scanning).
 * Returns Map<name, value>.
 */
export function getAllSecretValues() {
  const vault = loadVault();
  const map = new Map();

  for (const [name, secret] of Object.entries(vault.secrets)) {
    map.set(name, secret.value);
  }

  return map;
}

/**
 * Get all secrets with their allowed endpoints (for outbound scanning).
 * Returns Map<name, { value, allowedEndpoints }>.
 */
export function getAllSecretsWithEndpoints() {
  const vault = loadVault();
  const map = new Map();

  for (const [name, secret] of Object.entries(vault.secrets)) {
    map.set(name, {
      value: secret.value,
      allowedEndpoints: secret.allowedEndpoints ?? [],
    });
  }

  return map;
}

/**
 * Export vault data encrypted with a passphrase.
 */
export function exportVault(passphrase) {
  const vault = loadVault();
  const json = JSON.stringify(vault);
  const exported = encryptWithPassphrase(json, passphrase);

  logVaultEvent({
    event: "vault.export",
    action: "exported",
    secretCount: Object.keys(vault.secrets).length,
  });

  return JSON.stringify(exported, null, 2);
}

/**
 * Import vault data from a passphrase-encrypted export.
 */
export function importVault(exportJson, passphrase, options = {}) {
  const exportData = typeof exportJson === "string" ? JSON.parse(exportJson) : exportJson;
  const json = decryptWithPassphrase(exportData, passphrase);
  const importedVault = JSON.parse(json);

  if (options.merge) {
    // Merge into existing vault
    const current = loadVault();
    for (const [name, secret] of Object.entries(importedVault.secrets)) {
      if (!current.secrets[name] || options.overwrite) {
        current.secrets[name] = secret;
      }
    }
    saveVault(current);
  } else {
    // Replace entire vault
    saveVault(importedVault);
  }

  logVaultEvent({
    event: "vault.import",
    action: "imported",
    secretCount: Object.keys(importedVault.secrets).length,
    merge: Boolean(options.merge),
  });

  return importedVault;
}

/**
 * Redact a secret value for display.
 * Shows first 3 and last 3 characters with ellipsis.
 */
function redactValue(value) {
  if (!value || value.length < 8) return "***";
  const prefix = value.slice(0, 4);
  const suffix = value.slice(-3);
  return `${prefix}...${suffix}`;
}

/**
 * Check if a string is a vault reference.
 */
export function isVaultRef(value) {
  return typeof value === "string" && value.startsWith(VAULT_REF_PREFIX);
}

/**
 * Extract secret name from a vault reference.
 */
export function parseVaultRef(ref) {
  if (!isVaultRef(ref)) return null;
  return ref.slice(VAULT_REF_PREFIX.length);
}

/**
 * Resolve a vault reference to its actual value.
 */
export function resolveVaultRef(ref) {
  const name = parseVaultRef(ref);
  if (!name) return ref;

  const secret = getSecret(name, { logAccess: false });
  if (!secret) {
    throw new Error(`Vault secret "${name}" referenced in config not found`);
  }

  return secret.value;
}

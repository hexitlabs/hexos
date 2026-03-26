/**
 * HexOS Vault — Config resolver.
 *
 * Resolves $vault:NAME references in hexos.json config objects.
 * Called at gateway boot time to inject vault values into memory.
 * The config on disk still contains $vault: placeholders.
 */

import { isVaultRef, resolveVaultRef, loadVault } from "./store.js";
import { logVaultEvent } from "./audit.js";
import { VAULT_REF_PREFIX } from "./types.js";

/**
 * Deep-resolve all $vault:NAME references in a config object.
 * Returns a new object with vault references replaced by actual values.
 * The original object is not modified.
 */
export function resolveVaultRefsInConfig(obj, configPath = "") {
  if (typeof obj === "string") {
    if (isVaultRef(obj)) {
      const name = obj.slice(VAULT_REF_PREFIX.length);
      try {
        const value = resolveVaultRef(obj);
        logVaultEvent({
          event: "vault.access",
          secret: name,
          action: "inject",
          tool: "config-resolver",
          endpoint: configPath,
          result: "allowed",
        });
        return value;
      } catch (err) {
        logVaultEvent({
          event: "vault.access",
          secret: name,
          action: "inject",
          tool: "config-resolver",
          endpoint: configPath,
          result: "error",
          error: err.message,
        });
        throw err;
      }
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) =>
      resolveVaultRefsInConfig(item, `${configPath}[${index}]`)
    );
  }

  if (obj && typeof obj === "object" && Object.prototype.toString.call(obj) === "[object Object]") {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const childPath = configPath ? `${configPath}.${key}` : key;
      result[key] = resolveVaultRefsInConfig(val, childPath);
    }
    return result;
  }

  // Primitives pass through
  return obj;
}

/**
 * Check if a config object contains any vault references.
 */
export function hasVaultRefs(obj) {
  if (typeof obj === "string") {
    return isVaultRef(obj);
  }

  if (Array.isArray(obj)) {
    return obj.some((item) => hasVaultRefs(item));
  }

  if (obj && typeof obj === "object") {
    return Object.values(obj).some((val) => hasVaultRefs(val));
  }

  return false;
}

/**
 * Collect all vault references from a config object.
 * Returns array of { path, name } objects.
 */
export function collectVaultRefs(obj, configPath = "") {
  const refs = [];

  if (typeof obj === "string") {
    if (isVaultRef(obj)) {
      refs.push({
        path: configPath,
        name: obj.slice(VAULT_REF_PREFIX.length),
      });
    }
    return refs;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      refs.push(...collectVaultRefs(item, `${configPath}[${index}]`));
    });
    return refs;
  }

  if (obj && typeof obj === "object") {
    for (const [key, val] of Object.entries(obj)) {
      const childPath = configPath ? `${configPath}.${key}` : key;
      refs.push(...collectVaultRefs(val, childPath));
    }
  }

  return refs;
}

/**
 * Verify that all vault references in config can be resolved.
 * Returns { valid: boolean, missing: string[] }.
 */
export function validateVaultRefs(cfg) {
  const refs = collectVaultRefs(cfg);
  const missing = [];

  let vault;
  try {
    vault = loadVault();
  } catch {
    return { valid: refs.length === 0, missing: refs.map((r) => r.name) };
  }

  for (const ref of refs) {
    if (!vault.secrets[ref.name]) {
      missing.push(ref.name);
    }
  }

  return { valid: missing.length === 0, missing };
}

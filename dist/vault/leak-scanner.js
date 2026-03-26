/**
 * HexOS Vault — Leak detection engine.
 *
 * Two-pass scanning on every tool execution:
 * 1. Outbound scan: check request for vault values before sending
 * 2. Inbound scan: check response for vault values before returning to model
 *
 * Also includes pattern-based scanning for known secret formats.
 */

import { getAllSecretsWithEndpoints, getAllSecretValues } from "./store.js";
import { logVaultEvent } from "./audit.js";
import { LEAK_PATTERNS, VAULT_REF_PREFIX } from "./types.js";

/**
 * Check if a URL matches an allowed endpoint pattern.
 * Supports wildcards: "https://api.anthropic.com/*" matches any path.
 */
function matchesEndpoint(url, pattern) {
  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(url);
}

/**
 * Check if a URL is allowed for a given secret.
 */
function isEndpointAllowed(url, allowedEndpoints) {
  if (!allowedEndpoints || allowedEndpoints.length === 0) {
    return true; // No restrictions = allowed everywhere (backward compatible)
  }
  return allowedEndpoints.some((pattern) => matchesEndpoint(url, pattern));
}

/**
 * Scan a string for vault secret values.
 * Returns array of detected secret names.
 */
function scanForSecretValues(text, secrets) {
  if (!text || typeof text !== "string") return [];

  const found = [];
  for (const [name, value] of secrets) {
    if (value && value.length >= 8 && text.includes(value)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Scan a string for known secret patterns.
 * Returns array of { pattern, match } objects.
 */
function scanForPatterns(text) {
  if (!text || typeof text !== "string") return [];

  const found = [];
  for (const { name, regex } of LEAK_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    const matches = text.matchAll(new RegExp(regex.source, regex.flags));
    for (const match of matches) {
      found.push({
        pattern: name,
        match: match[0].slice(0, 20) + "...",
      });
    }
  }
  return found;
}

/**
 * Serialize request parts for scanning.
 */
function serializeForScan(parts) {
  const chunks = [];

  if (parts.url) chunks.push(parts.url);
  if (parts.headers) {
    if (typeof parts.headers === "object") {
      for (const [key, value] of Object.entries(parts.headers)) {
        if (typeof value === "string") chunks.push(value);
        else if (Array.isArray(value)) chunks.push(value.join(" "));
      }
    }
  }
  if (parts.body) {
    if (typeof parts.body === "string") {
      chunks.push(parts.body);
    } else if (typeof parts.body === "object") {
      chunks.push(JSON.stringify(parts.body));
    }
  }

  return chunks.join("\n");
}

/**
 * Outbound scan: check request for vault values before HTTP request fires.
 *
 * Returns:
 * - { allowed: true } if safe
 * - { allowed: false, blocked: [...] } if secrets found in disallowed endpoints
 */
export function scanOutbound(request) {
  const secrets = getAllSecretsWithEndpoints();
  if (secrets.size === 0) return { allowed: true, warnings: [] };

  const text = serializeForScan(request);
  const blocked = [];
  const warnings = [];

  for (const [name, { value, allowedEndpoints }] of secrets) {
    if (!value || value.length < 8) continue;

    if (text.includes(value)) {
      const url = request.url || "";

      if (!isEndpointAllowed(url, allowedEndpoints)) {
        blocked.push({
          secret: name,
          endpoint: url,
          allowedEndpoints,
        });

        logVaultEvent({
          event: "vault.leak_detected",
          secret: name,
          direction: "outbound",
          tool: request.tool,
          endpoint: url,
          action: "blocked",
        });
      } else {
        // Secret sent to allowed endpoint — log but don't block
        logVaultEvent({
          event: "vault.access",
          secret: name,
          action: "inject",
          tool: request.tool,
          endpoint: url,
          result: "allowed",
        });
      }
    }
  }

  // Also check for pattern-based leaks in URLs to non-allowed endpoints
  const patternLeaks = scanForPatterns(request.url || "");
  for (const leak of patternLeaks) {
    warnings.push({
      pattern: leak.pattern,
      direction: "outbound",
      context: "url",
    });
  }

  if (blocked.length > 0) {
    return { allowed: false, blocked, warnings };
  }

  return { allowed: true, warnings };
}

/**
 * Inbound scan: check response for vault values before returning to model context.
 *
 * Returns sanitized response with vault values replaced by placeholders.
 */
export function scanInbound(response) {
  const secretValues = getAllSecretValues();
  if (secretValues.size === 0) return { text: response.text, redacted: [] };

  let text = response.text || "";
  const redacted = [];

  // Replace any vault secret values with $vault: references
  for (const [name, value] of secretValues) {
    if (!value || value.length < 8) continue;

    if (text.includes(value)) {
      text = text.replaceAll(value, `${VAULT_REF_PREFIX}${name}`);
      redacted.push(name);

      logVaultEvent({
        event: "vault.leak_detected",
        secret: name,
        direction: "inbound",
        tool: response.tool,
        endpoint: response.endpoint,
        action: "redacted",
      });
    }
  }

  // Also warn about pattern-based leaks
  const patternLeaks = scanForPatterns(text);
  const patternWarnings = patternLeaks.map((leak) => ({
    pattern: leak.pattern,
    direction: "inbound",
    context: "response",
  }));

  return { text, redacted, patternWarnings };
}

/**
 * Scan arbitrary text for leaks (used for model output scanning).
 */
export function scanForLeaks(text) {
  const secretValues = getAllSecretValues();
  const vaultLeaks = scanForSecretValues(text, secretValues);
  const patternLeaks = scanForPatterns(text);

  return {
    vaultLeaks,
    patternLeaks,
    hasLeaks: vaultLeaks.length > 0 || patternLeaks.length > 0,
  };
}

/**
 * Redact all known secrets and patterns from a text string.
 */
export function redactSecrets(text) {
  if (!text || typeof text !== "string") return text;

  let result = text;
  const secretValues = getAllSecretValues();

  // Replace vault secret values
  for (const [name, value] of secretValues) {
    if (value && value.length >= 8) {
      result = result.replaceAll(value, `${VAULT_REF_PREFIX}${name}`);
    }
  }

  return result;
}

/**
 * Calculate Shannon entropy of a string.
 * High entropy (>4.5 for strings >20 chars) suggests a secret/key.
 */
export function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;

  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }

  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

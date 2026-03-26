/**
 * HexOS Vault — Audit trail.
 *
 * Logs all vault access events to ~/.hexos/audit/vault.jsonl.
 * Events: access, inject, leak_detected, rotation, migration, export, import.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const AUDIT_DIR = path.join(os.homedir(), ".hexos", "audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "vault.jsonl");

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Log a vault audit event.
 */
export function logVaultEvent(event) {
  try {
    ensureAuditDir();

    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", {
      mode: 0o600,
    });
  } catch {
    // Best-effort logging — don't crash the gateway for audit failures
  }
}

/**
 * Read vault audit events, optionally filtered.
 */
export function readVaultAuditLog(options = {}) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);

    let events = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Apply filters
    if (options.secret) {
      events = events.filter((e) => e.secret === options.secret);
    }
    if (options.event) {
      events = events.filter((e) => e.event === options.event);
    }
    if (options.limit) {
      events = events.slice(-options.limit);
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Get the audit log file path.
 */
export function getAuditLogPath() {
  return AUDIT_FILE;
}

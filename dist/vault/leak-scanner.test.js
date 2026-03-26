/**
 * Tests for vault leak detection engine.
 *
 * Sets up a real temporary vault to test scan/redact paths end-to-end.
 * HOME is set before modules are imported to ensure correct paths.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// Set up temp HOME BEFORE importing vault modules (they cache paths at import time)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hexos-leak-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpDir;

// Create required directory structure
const hexosDir = path.join(tmpDir, ".hexos");
const identityDir = path.join(hexosDir, "identity");
const auditDir = path.join(hexosDir, "audit");
fs.mkdirSync(identityDir, { recursive: true });
fs.mkdirSync(auditDir, { recursive: true });

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
fs.writeFileSync(
  path.join(identityDir, "device.json"),
  JSON.stringify({ privateKeyPem }),
  { mode: 0o600 }
);

// NOW import vault modules (they'll use our temp HOME)
const {
  shannonEntropy,
  scanOutbound,
  scanInbound,
  scanForLeaks,
  redactSecrets,
  configureLeakScanner,
} = await import("./leak-scanner.js");
const { setSecret, clearVaultCache } = await import("./store.js");

describe("vault/leak-scanner", () => {
  after(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearVaultCache();
    configureLeakScanner({ requireEndpoints: false });
    const vaultPath = path.join(tmpDir, ".hexos", "vault.enc");
    if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
  });

  describe("shannonEntropy", () => {
    it("returns 0 for empty string", () => {
      assert.equal(shannonEntropy(""), 0);
    });

    it("returns 0 for null/undefined input", () => {
      assert.equal(shannonEntropy(null), 0);
      assert.equal(shannonEntropy(undefined), 0);
    });

    it("returns 0 for single repeated character", () => {
      assert.equal(shannonEntropy("aaaaaaaaaa"), 0);
    });

    it("returns low entropy for simple strings", () => {
      const entropy = shannonEntropy("hello");
      assert.ok(entropy > 0);
      assert.ok(entropy < 3);
    });

    it("returns high entropy for random-looking strings", () => {
      const entropy = shannonEntropy(
        "sk-ant-api03-Xb9K2mQ7nR4pL8sT1wV5yZ0aC3dE6fG8hJ-kMnOpQrStUvWxYz"
      );
      assert.ok(entropy > 4, `Expected entropy > 4, got ${entropy}`);
    });

    it("returns high entropy for actual API key format", () => {
      const entropy = shannonEntropy("BSAjf8sd9f8JKsdf98jsdf98jsd9f8j");
      assert.ok(entropy > 3.0, `Expected entropy > 3.0, got ${entropy}`);
    });
  });

  describe("scanOutbound", () => {
    it("returns allowed:true when no secrets exist", () => {
      const result = scanOutbound({ url: "https://example.com", body: "hello" });
      assert.equal(result.allowed, true);
    });

    it("blocks secret sent to disallowed endpoint", () => {
      setSecret("API_KEY", "sk-ant-api03-TESTKEY12345678", {
        allowedEndpoints: ["https://api.anthropic.com/*"],
      });

      const result = scanOutbound({
        url: "https://evil.com/steal",
        body: "here is sk-ant-api03-TESTKEY12345678 leaked",
      });

      assert.equal(result.allowed, false);
      assert.equal(result.blocked.length, 1);
      assert.equal(result.blocked[0].secret, "API_KEY");
    });

    it("allows secret sent to allowed endpoint", () => {
      setSecret("API_KEY2", "sk-ant-api03-ALLOWED-KEY-9999", {
        allowedEndpoints: ["https://api.anthropic.com/*"],
      });

      const result = scanOutbound({
        url: "https://api.anthropic.com/v1/messages",
        headers: { Authorization: "Bearer sk-ant-api03-ALLOWED-KEY-9999" },
      });

      assert.equal(result.allowed, true);
    });

    it("warns when secret has no allowedEndpoints (default-open policy)", () => {
      setSecret("OPEN_KEY", "some-secret-value-12345", {
        allowedEndpoints: [],
      });

      const result = scanOutbound({
        url: "https://anywhere.com/api",
        body: "sending some-secret-value-12345",
      });

      assert.equal(result.allowed, true);
      assert.ok(result.warnings.length > 0, "Should produce a warning");
      assert.ok(
        result.warnings.some((w) => w.secret === "OPEN_KEY"),
        "Warning should reference the secret"
      );
    });

    it("blocks secret without allowedEndpoints in strict mode", () => {
      configureLeakScanner({ requireEndpoints: true });

      setSecret("STRICT_KEY", "strict-mode-secret-val", {
        allowedEndpoints: [],
      });

      const result = scanOutbound({
        url: "https://anywhere.com/api",
        body: "sending strict-mode-secret-val",
      });

      assert.equal(result.allowed, false);
      assert.equal(result.blocked.length, 1);
      assert.equal(result.blocked[0].secret, "STRICT_KEY");
    });

    it("scans headers for secrets", () => {
      setSecret("HDR_TOKEN", "Bearer-Token-Secret-Value", {
        allowedEndpoints: ["https://api.example.com/*"],
      });

      const result = scanOutbound({
        url: "https://evil.com/api",
        headers: { Authorization: "Bearer-Token-Secret-Value" },
      });

      assert.equal(result.allowed, false);
    });

    it("detects pattern-based leaks in URLs", () => {
      const result = scanOutbound({
        url: "https://example.com/?key=sk-ant-api03-ABCDEFGHIJKLMNOPQRST",
      });

      assert.ok(result.warnings.some((w) => w.pattern === "anthropic_key"));
    });

    it("scans short secrets (< 8 chars but >= 4 chars)", () => {
      setSecret("SHORT", "abcd", {
        allowedEndpoints: ["https://safe.com/*"],
      });

      const result = scanOutbound({
        url: "https://evil.com",
        body: "has abcd in it",
      });

      assert.equal(result.allowed, false);
    });
  });

  describe("scanInbound", () => {
    it("returns original text when no secrets exist", () => {
      const result = scanInbound({ text: "hello world" });
      assert.equal(result.text, "hello world");
      assert.equal(result.redacted.length, 0);
    });

    it("redacts secret values in response text", () => {
      setSecret("MY_KEY", "sk-ant-api03-TESTVALUE123");

      const result = scanInbound({
        text: "Your key is sk-ant-api03-TESTVALUE123 and it works",
      });

      assert.ok(!result.text.includes("sk-ant-api03-TESTVALUE123"));
      assert.ok(result.text.includes("$vault:MY_KEY"));
      assert.deepEqual(result.redacted, ["MY_KEY"]);
    });

    it("redacts multiple secrets", () => {
      setSecret("KEY_A", "secret-value-alpha-123");
      setSecret("KEY_B", "secret-value-beta-4567");

      const result = scanInbound({
        text: "A=secret-value-alpha-123 B=secret-value-beta-4567",
      });

      assert.ok(result.text.includes("$vault:KEY_A"));
      assert.ok(result.text.includes("$vault:KEY_B"));
      assert.equal(result.redacted.length, 2);
    });
  });

  describe("scanForLeaks", () => {
    it("detects vault secret values in text", () => {
      setSecret("LEAK_KEY", "sk-ant-api03-LEAKEDVALUE");

      const result = scanForLeaks("found sk-ant-api03-LEAKEDVALUE in output");
      assert.ok(result.hasLeaks);
      assert.deepEqual(result.vaultLeaks, ["LEAK_KEY"]);
    });

    it("detects pattern-based leaks", () => {
      const result = scanForLeaks("key is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn");
      assert.ok(result.hasLeaks);
      assert.ok(result.patternLeaks.some((l) => l.pattern === "github_pat"));
    });

    it("returns no leaks for clean text", () => {
      const result = scanForLeaks("just a normal response with no secrets");
      assert.equal(result.hasLeaks, false);
    });
  });

  describe("redactSecrets", () => {
    it("replaces known secret values with vault refs", () => {
      setSecret("DB_PASS", "super-secret-password-1234");

      const result = redactSecrets("connection: super-secret-password-1234@host");
      assert.ok(result.includes("$vault:DB_PASS"));
      assert.ok(!result.includes("super-secret-password-1234"));
    });

    it("handles null/undefined input", () => {
      assert.equal(redactSecrets(null), null);
      assert.equal(redactSecrets(undefined), undefined);
    });

    it("returns original text when no secrets match", () => {
      const text = "nothing secret here";
      assert.equal(redactSecrets(text), text);
    });
  });
});

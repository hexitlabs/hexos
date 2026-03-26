/**
 * Tests for vault storage layer — CRUD operations.
 *
 * Sets up a temporary HOME before importing store module to ensure
 * all paths point to our temp directory.
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// Set up temp HOME BEFORE importing store (it caches paths at import time)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hexos-store-test-"));
const origHome = process.env.HOME;
process.env.HOME = tmpDir;

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

// NOW import store module
const {
  setSecret,
  getSecret,
  listSecrets,
  removeSecret,
  rotateSecret,
  clearVaultCache,
  exportVault,
  importVault,
  getAllSecretValues,
  getAllSecretsWithEndpoints,
} = await import("./store.js");

describe("vault/store (CRUD)", () => {
  after(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearVaultCache();
    const vaultPath = path.join(tmpDir, ".hexos", "vault.enc");
    if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
  });

  it("setSecret creates a new secret", () => {
    const result = setSecret("TEST_KEY", "my-secret-value-12345", {
      tags: ["test"],
      allowedEndpoints: ["https://api.test.com/*"],
    });

    assert.equal(result.value, "my-secret-value-12345");
    assert.deepEqual(result.tags, ["test"]);
    assert.deepEqual(result.allowedEndpoints, ["https://api.test.com/*"]);
    assert.ok(result.createdAt);
    assert.ok(result.updatedAt);
  });

  it("getSecret retrieves a stored secret", () => {
    setSecret("READ_KEY", "readable-value-98765");
    const secret = getSecret("READ_KEY");
    assert.ok(secret);
    assert.equal(secret.value, "readable-value-98765");
  });

  it("getSecret returns null for non-existent secret", () => {
    const secret = getSecret("DOES_NOT_EXIST");
    assert.equal(secret, null);
  });

  it("listSecrets returns redacted entries", () => {
    setSecret("LIST_KEY_A", "alpha-secret-value-111");
    setSecret("LIST_KEY_B", "beta-secret-value-2222");

    const list = listSecrets();
    const keys = Object.keys(list);
    assert.ok(keys.includes("LIST_KEY_A"));
    assert.ok(keys.includes("LIST_KEY_B"));

    // Values should be redacted (contain "...")
    assert.ok(list.LIST_KEY_A.redactedValue.includes("..."));
    assert.ok(!list.LIST_KEY_A.redactedValue.includes("alpha-secret-value-111"));
  });

  it("removeSecret deletes a secret", () => {
    setSecret("REMOVE_ME", "to-be-deleted-value-1");
    const removed = removeSecret("REMOVE_ME");
    assert.equal(removed, true);
    const secret = getSecret("REMOVE_ME");
    assert.equal(secret, null);
  });

  it("removeSecret returns false for non-existent secret", () => {
    const removed = removeSecret("NEVER_EXISTED");
    assert.equal(removed, false);
  });

  it("rotateSecret updates the value", () => {
    setSecret("ROTATE_KEY", "old-value-1234567890");
    const rotated = rotateSecret("ROTATE_KEY", "new-value-0987654321");
    assert.equal(rotated.value, "new-value-0987654321");

    const secret = getSecret("ROTATE_KEY");
    assert.equal(secret.value, "new-value-0987654321");
  });

  it("rotateSecret throws for non-existent secret", () => {
    assert.throws(
      () => rotateSecret("NO_SUCH_KEY", "new-value"),
      /not found in vault/
    );
  });

  it("setSecret updates existing secret, preserving createdAt", () => {
    setSecret("UPDATE_KEY", "first-value-abcdefgh");
    const first = getSecret("UPDATE_KEY");

    setSecret("UPDATE_KEY", "second-value-ijklmnop", { tags: ["updated"] });
    const second = getSecret("UPDATE_KEY");

    assert.equal(second.value, "second-value-ijklmnop");
    assert.equal(second.createdAt, first.createdAt);
    assert.deepEqual(second.tags, ["updated"]);
  });

  it("vault data persists to disk after clearVaultCache", () => {
    setSecret("PERSIST_KEY", "persistent-value-xyz");
    clearVaultCache();

    const secret = getSecret("PERSIST_KEY");
    assert.ok(secret);
    assert.equal(secret.value, "persistent-value-xyz");
  });

  it("getAllSecretValues returns a Map of name→value", () => {
    setSecret("MAP_A", "value-aaa-12345678");
    setSecret("MAP_B", "value-bbb-87654321");

    const map = getAllSecretValues();
    assert.ok(map instanceof Map);
    assert.equal(map.get("MAP_A"), "value-aaa-12345678");
    assert.equal(map.get("MAP_B"), "value-bbb-87654321");
  });

  it("getAllSecretsWithEndpoints includes allowedEndpoints", () => {
    setSecret("EP_KEY", "endpoint-test-value-1", {
      allowedEndpoints: ["https://api.example.com/*"],
    });

    const map = getAllSecretsWithEndpoints();
    const entry = map.get("EP_KEY");
    assert.ok(entry);
    assert.equal(entry.value, "endpoint-test-value-1");
    assert.deepEqual(entry.allowedEndpoints, ["https://api.example.com/*"]);
  });
});

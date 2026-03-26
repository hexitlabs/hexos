/**
 * Tests for vault cryptographic operations.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  deriveVaultKey,
  encrypt,
  decrypt,
  encryptVault,
  decryptVault,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from "./crypto.js";

// Generate a test Ed25519 key pair
function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

describe("vault/crypto", () => {
  let testKeyPair;

  before(() => {
    testKeyPair = generateTestKeyPair();
  });

  describe("deriveVaultKey", () => {
    it("derives a 32-byte key from private key PEM", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      assert.equal(key.length, 32);
      assert.ok(Buffer.isBuffer(key));
    });

    it("derives the same key for the same private key", () => {
      const key1 = deriveVaultKey(testKeyPair.privateKeyPem);
      const key2 = deriveVaultKey(testKeyPair.privateKeyPem);
      assert.ok(key1.equals(key2));
    });

    it("derives different keys for different private keys", () => {
      const otherKeyPair = generateTestKeyPair();
      const key1 = deriveVaultKey(testKeyPair.privateKeyPem);
      const key2 = deriveVaultKey(otherKeyPair.privateKeyPem);
      assert.ok(!key1.equals(key2));
    });
  });

  describe("encrypt/decrypt", () => {
    it("round-trips a plaintext string", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const plaintext = "sk-ant-api03-REAL-KEY-HERE-12345";

      const encrypted = encrypt(plaintext, key);
      assert.ok(encrypted.iv);
      assert.ok(encrypted.ciphertext);
      assert.ok(encrypted.tag);

      const decrypted = decrypt(encrypted, key);
      assert.equal(decrypted, plaintext);
    });

    it("produces unique IVs for each encryption", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const plaintext = "test-value";

      const enc1 = encrypt(plaintext, key);
      const enc2 = encrypt(plaintext, key);

      assert.notEqual(enc1.iv, enc2.iv);
      assert.notEqual(enc1.ciphertext, enc2.ciphertext);
    });

    it("fails to decrypt with wrong key", () => {
      const key1 = deriveVaultKey(testKeyPair.privateKeyPem);
      const key2 = deriveVaultKey(generateTestKeyPair().privateKeyPem);
      const plaintext = "secret-value";

      const encrypted = encrypt(plaintext, key1);

      assert.throws(() => decrypt(encrypted, key2));
    });

    it("fails on tampered ciphertext", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const encrypted = encrypt("secret", key);

      // Tamper with ciphertext
      const buf = Buffer.from(encrypted.ciphertext, "base64");
      buf[0] ^= 0xff;
      encrypted.ciphertext = buf.toString("base64");

      assert.throws(() => decrypt(encrypted, key));
    });
  });

  describe("encryptVault/decryptVault", () => {
    it("round-trips a vault data structure", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const vaultData = {
        version: 1,
        secrets: {
          API_KEY: {
            value: "sk-test-12345",
            createdAt: "2026-03-26T10:00:00Z",
            updatedAt: "2026-03-26T10:00:00Z",
            usedBy: ["models.anthropic"],
            tags: ["llm"],
            allowedEndpoints: ["https://api.anthropic.com/*"],
          },
        },
        metadata: {
          lastAccessed: "2026-03-26T10:00:00Z",
          secretCount: 1,
        },
      };

      const encrypted = encryptVault(vaultData, key);
      const decrypted = decryptVault(encrypted, key);

      assert.deepEqual(decrypted, vaultData);
    });
  });

  describe("passphrase encryption", () => {
    it("round-trips with a passphrase", () => {
      const plaintext = JSON.stringify({ test: "data", secret: "value" });
      const passphrase = "my-backup-password-123";

      const exported = encryptWithPassphrase(plaintext, passphrase);
      assert.equal(exported.version, 1);
      assert.equal(exported.kdf, "pbkdf2");
      assert.ok(exported.salt);
      assert.ok(exported.iv);
      assert.ok(exported.ciphertext);
      assert.ok(exported.tag);

      const decrypted = decryptWithPassphrase(exported, passphrase);
      assert.equal(decrypted, plaintext);
    });

    it("fails with wrong passphrase", () => {
      const plaintext = "secret data";
      const exported = encryptWithPassphrase(plaintext, "correct-pass");
      assert.throws(() => decryptWithPassphrase(exported, "wrong-pass"));
    });
  });

  describe("negative cases — corruption and tampering", () => {
    it("fails to decrypt with corrupted IV", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const encrypted = encrypt("test data", key);

      // Corrupt the IV
      const ivBuf = Buffer.from(encrypted.iv, "base64");
      ivBuf[0] ^= 0xff;
      encrypted.iv = ivBuf.toString("base64");

      assert.throws(() => decrypt(encrypted, key));
    });

    it("fails to decrypt with tampered auth tag", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const encrypted = encrypt("sensitive info", key);

      // Tamper with the auth tag
      const tagBuf = Buffer.from(encrypted.tag, "base64");
      tagBuf[0] ^= 0xff;
      encrypted.tag = tagBuf.toString("base64");

      assert.throws(() => decrypt(encrypted, key));
    });

    it("fails to decrypt with truncated ciphertext", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const encrypted = encrypt("some content to encrypt for testing", key);

      // Truncate ciphertext
      const buf = Buffer.from(encrypted.ciphertext, "base64");
      encrypted.ciphertext = buf.subarray(0, Math.floor(buf.length / 2)).toString("base64");

      assert.throws(() => decrypt(encrypted, key));
    });

    it("fails to decrypt with empty ciphertext", () => {
      const key = deriveVaultKey(testKeyPair.privateKeyPem);
      const encrypted = encrypt("data", key);

      encrypted.ciphertext = "";

      assert.throws(() => decrypt(encrypted, key));
    });

    it("fails to decrypt vault data with wrong key", () => {
      const key1 = deriveVaultKey(testKeyPair.privateKeyPem);
      const key2 = deriveVaultKey(generateTestKeyPair().privateKeyPem);

      const vaultData = {
        version: 1,
        secrets: { KEY: { value: "secret" } },
        metadata: { lastAccessed: new Date().toISOString(), secretCount: 1 },
      };

      const encrypted = encryptVault(vaultData, key1);
      assert.throws(() => decryptVault(encrypted, key2));
    });

    it("fails passphrase decryption with tampered ciphertext", () => {
      const exported = encryptWithPassphrase("important data", "my-pass");

      // Tamper with ciphertext
      const buf = Buffer.from(exported.ciphertext, "base64");
      buf[0] ^= 0xff;
      exported.ciphertext = buf.toString("base64");

      assert.throws(() => decryptWithPassphrase(exported, "my-pass"));
    });

    it("fails passphrase decryption with tampered salt", () => {
      const exported = encryptWithPassphrase("data", "pass123");

      // Tamper with salt (changes the derived key)
      const saltBuf = Buffer.from(exported.salt, "base64");
      saltBuf[0] ^= 0xff;
      exported.salt = saltBuf.toString("base64");

      assert.throws(() => decryptWithPassphrase(exported, "pass123"));
    });

    it("deriveVaultKey throws for invalid PEM input", () => {
      assert.throws(() => deriveVaultKey("not-a-valid-pem"));
    });
  });
});

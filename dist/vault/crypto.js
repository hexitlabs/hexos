/**
 * HexOS Vault — Cryptographic operations.
 *
 * AES-256-GCM encryption with HKDF-SHA256 key derivation from the device private key.
 * Each secret gets a unique IV. Authentication tags prevent tampering.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;
const HKDF_INFO = "hexos-vault-v1";
const HKDF_SALT = "hexos-vault-encryption-key";

/**
 * Derive AES-256 encryption key from device private key using HKDF-SHA256.
 */
export function deriveVaultKey(privateKeyPem) {
  // Extract raw private key bytes for HKDF input keying material
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  const ikm = crypto.createHash("sha256").update(pkcs8).digest();

  // HKDF-SHA256 to derive 32-byte AES key
  const hkdfKey = crypto.hkdfSync(
    "sha256",
    ikm,
    Buffer.from(HKDF_SALT, "utf8"),
    Buffer.from(HKDF_INFO, "utf8"),
    32
  );

  return Buffer.from(hkdfKey);
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns: { iv, ciphertext, tag } all as base64 strings.
 */
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted value.
 */
export function decrypt(encryptedData, key) {
  const iv = Buffer.from(encryptedData.iv, "base64");
  const ciphertext = Buffer.from(encryptedData.ciphertext, "base64");
  const tag = Buffer.from(encryptedData.tag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypt the entire vault data structure.
 */
export function encryptVault(vaultData, key) {
  const json = JSON.stringify(vaultData);
  return encrypt(json, key);
}

/**
 * Decrypt the entire vault data structure.
 */
export function decryptVault(encryptedData, key) {
  const json = decrypt(encryptedData, key);
  return JSON.parse(json);
}

/**
 * Load the device private key from the identity file.
 */
export function loadDevicePrivateKey(identityDir) {
  const dir = identityDir ?? path.join(os.homedir(), ".hexos", "identity");
  const filePath = path.join(dir, "device.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Device identity not found at ${filePath}. Run 'hexos configure' first.`
    );
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed?.privateKeyPem) {
    throw new Error(`Invalid device identity file: missing privateKeyPem`);
  }

  return parsed.privateKeyPem;
}

/**
 * Encrypt for export with a passphrase (PBKDF2 + AES-256-GCM).
 */
export function encryptWithPassphrase(plaintext, passphrase) {
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: "pbkdf2",
    iterations: 100000,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt an export encrypted with a passphrase.
 */
export function decryptWithPassphrase(exportData, passphrase) {
  const salt = Buffer.from(exportData.salt, "base64");
  const key = crypto.pbkdf2Sync(
    passphrase,
    salt,
    exportData.iterations || 100000,
    32,
    "sha256"
  );
  const iv = Buffer.from(exportData.iv, "base64");
  const ciphertext = Buffer.from(exportData.ciphertext, "base64");
  const tag = Buffer.from(exportData.tag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

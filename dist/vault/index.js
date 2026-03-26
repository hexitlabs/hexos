/**
 * HexOS Vault — Main entry point.
 *
 * Encrypted credential storage with boundary injection and two-pass leak detection.
 */

export {
  VAULT_VERSION,
  VAULT_REF_PREFIX,
  SECRET_FIELD_NAMES,
  SECRET_VALUE_PATTERNS,
  LEAK_PATTERNS,
  PROVIDER_ENDPOINTS,
} from "./types.js";

export {
  deriveVaultKey,
  encrypt,
  decrypt,
  encryptVault,
  decryptVault,
  loadDevicePrivateKey,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from "./crypto.js";

export {
  resolveVaultPath,
  loadVault,
  saveVault,
  clearVaultCache,
  setSecret,
  getSecret,
  listSecrets,
  removeSecret,
  rotateSecret,
  getAllSecretValues,
  getAllSecretsWithEndpoints,
  exportVault,
  importVault,
  isVaultRef,
  parseVaultRef,
  resolveVaultRef,
} from "./store.js";

export {
  resolveVaultRefsInConfig,
  hasVaultRefs,
  collectVaultRefs,
  validateVaultRefs,
} from "./config-resolver.js";

export {
  scanConfigForMigration,
  migrateConfigSecretsAsync,
} from "./migrate.js";

export {
  scanOutbound,
  scanInbound,
  scanForLeaks,
  redactSecrets,
  shannonEntropy,
  configureLeakScanner,
} from "./leak-scanner.js";

export {
  logVaultEvent,
  readVaultAuditLog,
  getAuditLogPath,
} from "./audit.js";

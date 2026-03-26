/**
 * HexOS Profile Rollback — Phase 2 (v0.8.0)
 *
 * Backup and restore mechanism for profile changes.
 * Writes `.hexos-profile-backup.json` alongside config.
 *
 * See PRD §9 for specification.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Default backup file path */
const DEFAULT_BACKUP_PATH = '.hexos-profile-backup.json';

/**
 * @typedef {Object} ProfileBackup
 * @property {string} timestamp - ISO 8601 timestamp of backup
 * @property {string} previousProfile - Profile name before change
 * @property {object} previousCapabilities - Capability overrides before change
 * @property {string} changedTo - New profile name
 * @property {string} changedBy - Who initiated the change ('cli' | 'api' | 'migration')
 */

/**
 * Backup the current profile config before a change.
 *
 * @param {object} currentConfig - Current profile config
 * @param {string} currentConfig.profile - Current profile name
 * @param {object} [currentConfig.capabilities] - Current capability overrides
 * @param {string} newProfile - The profile being changed to
 * @param {string} [changedBy='cli'] - Who initiated the change
 * @param {string} [backupDir='.'] - Directory to write backup file
 * @returns {ProfileBackup} The backup object that was written
 */
export function backupProfile(currentConfig, newProfile, changedBy = 'cli', backupDir = '.') {
  /** @type {ProfileBackup} */
  const backup = {
    timestamp: new Date().toISOString(),
    previousProfile: currentConfig.profile,
    previousCapabilities: currentConfig.capabilities || {},
    changedTo: newProfile,
    changedBy,
  };

  const filePath = join(backupDir, DEFAULT_BACKUP_PATH);
  writeFileSync(filePath, JSON.stringify(backup, null, 2) + '\n', 'utf-8');

  return backup;
}

/**
 * Rollback to the previously backed-up profile config.
 *
 * @param {string} [backupDir='.'] - Directory containing backup file
 * @returns {ProfileBackup} The backup data (caller applies it to config)
 * @throws {Error} If no backup exists
 */
export function rollbackProfile(backupDir = '.') {
  const filePath = join(backupDir, DEFAULT_BACKUP_PATH);

  if (!existsSync(filePath)) {
    throw new Error(
      'No profile backup found. Cannot rollback.\n' +
      'A backup is created automatically when you run `hexos profile set`.'
    );
  }

  const raw = readFileSync(filePath, 'utf-8');
  /** @type {ProfileBackup} */
  const backup = JSON.parse(raw);

  // Validate backup structure
  if (!backup.previousProfile || !backup.timestamp) {
    throw new Error('Corrupt backup file: missing required fields.');
  }

  return backup;
}

/**
 * Check whether a profile backup exists.
 *
 * @param {string} [backupDir='.'] - Directory to check
 * @returns {boolean}
 */
export function hasBackup(backupDir = '.') {
  const filePath = join(backupDir, DEFAULT_BACKUP_PATH);
  return existsSync(filePath);
}

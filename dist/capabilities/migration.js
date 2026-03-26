/**
 * HexOS Profile Migration — Phase 3 (v0.8.0)
 *
 * Migrates from v0.5.0 `deploymentProfile` field to v0.8.0 `profile`
 * capability system. Creates backup before migration and auto-restores
 * on error.
 *
 * See PRD §11.2 and §15 for specification.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_NAMES } from './presets.js';

/**
 * @typedef {Object} MigrationResult
 * @property {boolean} success - Whether migration completed
 * @property {boolean} migrated - Whether any changes were made
 * @property {string} output - Human-readable output
 * @property {string|null} previousProfile - Old deploymentProfile value
 * @property {string|null} newProfile - New profile value
 * @property {string|null} backupPath - Path to backup file
 */

/**
 * Profile mapping from legacy deploymentProfile to new profile system.
 * See PRD §15.1:
 *   - "operator" → "sovereign" (current operator installs have full access)
 *   - "managed" → "managed" (direct mapping)
 *   - absent → "sovereign" (self-installed = power user)
 */
const LEGACY_PROFILE_MAP = {
  operator: 'sovereign',
  managed: 'managed',
};

/**
 * Migrate hexos.json from v0.5.0 deploymentProfile to v0.8.0 profile system.
 *
 * @param {object} [options]
 * @param {string} [options.configPath] - Path to hexos.json
 * @param {object} [options.configData] - Provide config data directly (for testing)
 * @param {boolean} [options.dryRun=false] - If true, don't write changes
 * @param {boolean} [options.writeConfig=true] - Whether to write config file
 * @param {object} [options.logger] - Logger instance
 * @returns {MigrationResult}
 */
export function migrateProfile(options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const configPath = options.configPath || 'hexos.json';
  const dryRun = options.dryRun || false;
  const writeConfig = options.writeConfig !== false;

  let configData;
  let configText;

  // Load config
  if (options.configData) {
    configData = structuredClone
      ? structuredClone(options.configData)
      : JSON.parse(JSON.stringify(options.configData));
    configText = JSON.stringify(options.configData, null, 2);
  } else {
    if (!existsSync(configPath)) {
      return {
        success: false,
        migrated: false,
        output: `Config file not found: ${configPath}`,
        previousProfile: null,
        newProfile: null,
        backupPath: null,
      };
    }
    configText = readFileSync(configPath, 'utf-8');
    configData = JSON.parse(configText);
  }

  // Check if already migrated
  if (configData.profile && !configData.deploymentProfile) {
    return {
      success: true,
      migrated: false,
      output: `Already using v0.8.0 profile system (profile: "${configData.profile}"). No migration needed.`,
      previousProfile: null,
      newProfile: configData.profile,
      backupPath: null,
    };
  }

  // Detect old profile
  const oldProfile = configData.deploymentProfile || null;

  // Map to new profile
  let newProfile;
  if (oldProfile && oldProfile in LEGACY_PROFILE_MAP) {
    newProfile = LEGACY_PROFILE_MAP[oldProfile];
  } else if (oldProfile) {
    // Unknown old profile — default to sovereign with a warning
    logger.warn?.(`Unknown legacy deploymentProfile "${oldProfile}" — defaulting to "sovereign".`);
    newProfile = 'sovereign';
  } else {
    // No profile set at all — default to sovereign
    newProfile = 'sovereign';
  }

  // Build output
  const lines = [];
  lines.push('HexOS Profile Migration: v0.5.0 → v0.8.0');
  lines.push('');

  if (oldProfile) {
    lines.push(`  Before: deploymentProfile = "${oldProfile}"`);
  } else {
    lines.push(`  Before: no profile configured`);
  }
  lines.push(`  After:  profile = "${newProfile}"`);
  lines.push('');

  if (oldProfile !== newProfile && oldProfile) {
    lines.push(`  Note: "${oldProfile}" has been mapped to "${newProfile}".`);
    if (oldProfile === 'operator') {
      lines.push(`  Reason: Current "operator" installs have full access — that's "sovereign" behavior.`);
    }
    lines.push('');
  }

  if (dryRun) {
    lines.push('  [DRY RUN] No changes written.');
    return {
      success: true,
      migrated: false,
      output: lines.join('\n'),
      previousProfile: oldProfile,
      newProfile,
      backupPath: null,
    };
  }

  // Create backup
  const backupPath = configPath + '.pre-migration';

  if (writeConfig && !options.configData) {
    try {
      copyFileSync(configPath, backupPath);
      lines.push(`  Backup saved to: ${backupPath}`);
    } catch (err) {
      return {
        success: false,
        migrated: false,
        output: `Failed to create backup: ${err.message}`,
        previousProfile: oldProfile,
        newProfile: null,
        backupPath: null,
      };
    }
  }

  // Apply migration
  try {
    // Set new profile field
    configData.profile = newProfile;

    // Remove old deploymentProfile field
    delete configData.deploymentProfile;

    // Write config
    if (writeConfig && !options.configData) {
      writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
      lines.push(`  Config updated: ${configPath}`);
    }

    lines.push('');
    lines.push('  Migration complete. Restart required to apply changes.');

    return {
      success: true,
      migrated: true,
      output: lines.join('\n'),
      previousProfile: oldProfile,
      newProfile,
      backupPath: writeConfig && !options.configData ? backupPath : null,
      configData,
    };
  } catch (err) {
    // Restore from backup on error
    if (writeConfig && !options.configData && existsSync(backupPath)) {
      try {
        copyFileSync(backupPath, configPath);
        logger.warn?.('Migration failed — restored from backup.');
      } catch (restoreErr) {
        logger.error?.(`Migration failed AND backup restore failed: ${restoreErr.message}`);
      }
    }

    return {
      success: false,
      migrated: false,
      output: `Migration failed: ${err.message}`,
      previousProfile: oldProfile,
      newProfile: null,
      backupPath: null,
    };
  }
}

/**
 * Tests for Phase 3 migration — v0.5.0 deploymentProfile to v0.8.0 profile.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateProfile } from './migration.js';

/** Silent logger */
const silentLogger = { info() {}, warn() {}, error() {} };

describe('Profile Migration', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hexos-migration-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Migration from operator ──

  it('migrates "operator" to "sovereign"', () => {
    const result = migrateProfile({
      configData: { deploymentProfile: 'operator', model: 'claude' },
      logger: silentLogger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.previousProfile, 'operator');
    assert.strictEqual(result.newProfile, 'sovereign');
    assert.ok(result.configData.profile === 'sovereign');
    assert.strictEqual(result.configData.deploymentProfile, undefined);
  });

  // ── Migration from managed ──

  it('migrates "managed" to "managed"', () => {
    const result = migrateProfile({
      configData: { deploymentProfile: 'managed' },
      logger: silentLogger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.previousProfile, 'managed');
    assert.strictEqual(result.newProfile, 'managed');
  });

  // ── Migration when no profile set ──

  it('defaults to "sovereign" when no profile is set', () => {
    const result = migrateProfile({
      configData: { model: 'claude' },
      logger: silentLogger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.previousProfile, null);
    assert.strictEqual(result.newProfile, 'sovereign');
  });

  // ── Already migrated ──

  it('detects already-migrated config', () => {
    const result = migrateProfile({
      configData: { profile: 'sovereign', model: 'claude' },
      logger: silentLogger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, false);
    assert.ok(result.output.includes('No migration needed'));
  });

  // ── Backup creation on disk ──

  it('creates backup file before migrating', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({ deploymentProfile: 'operator', model: 'claude' }, null, 2));

    const result = migrateProfile({ configPath, logger: silentLogger });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.ok(existsSync(configPath + '.pre-migration'), 'Backup should exist');

    // Verify backup content
    const backup = JSON.parse(readFileSync(configPath + '.pre-migration', 'utf-8'));
    assert.strictEqual(backup.deploymentProfile, 'operator');
  });

  // ── Config file update ──

  it('writes updated config file', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({ deploymentProfile: 'operator', model: 'claude' }, null, 2));

    migrateProfile({ configPath, logger: silentLogger });

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(updated.profile, 'sovereign');
    assert.strictEqual(updated.deploymentProfile, undefined);
    assert.strictEqual(updated.model, 'claude'); // Preserved
  });

  // ── Removes old deploymentProfile field ──

  it('removes deploymentProfile field after migration', () => {
    const result = migrateProfile({
      configData: { deploymentProfile: 'operator', extra: 'data' },
      logger: silentLogger,
    });

    assert.strictEqual(result.configData.deploymentProfile, undefined);
    assert.strictEqual(result.configData.extra, 'data');
  });

  // ── Dry run ──

  it('dry run does not modify config', () => {
    const configPath = join(tempDir, 'hexos.json');
    const original = { deploymentProfile: 'operator', model: 'claude' };
    writeFileSync(configPath, JSON.stringify(original, null, 2));

    const result = migrateProfile({ configPath, dryRun: true, logger: silentLogger });

    assert.strictEqual(result.migrated, false);
    assert.ok(result.output.includes('DRY RUN'));

    // File should be unchanged
    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(onDisk.deploymentProfile, 'operator');
  });

  // ── Missing config file ──

  it('returns error when config file is missing', () => {
    const result = migrateProfile({
      configPath: join(tempDir, 'nonexistent.json'),
      logger: silentLogger,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.output.includes('not found'));
  });

  // ── Unknown legacy profile ──

  it('handles unknown legacy profile gracefully', () => {
    const warns = [];
    const logger = { info() {}, warn(m) { warns.push(m); }, error() {} };

    const result = migrateProfile({
      configData: { deploymentProfile: 'custom-profile' },
      logger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.newProfile, 'sovereign');
    assert.ok(warns.some(w => w.includes('Unknown legacy')));
  });

  // ── Output format ──

  it('prints before/after diff in output', () => {
    const result = migrateProfile({
      configData: { deploymentProfile: 'operator' },
      logger: silentLogger,
    });

    assert.ok(result.output.includes('Before'));
    assert.ok(result.output.includes('After'));
    assert.ok(result.output.includes('operator'));
    assert.ok(result.output.includes('sovereign'));
  });

  // ── Both fields present ──

  it('migrates correctly when both profile and deploymentProfile present', () => {
    const result = migrateProfile({
      configData: { profile: 'operator', deploymentProfile: 'managed' },
      logger: silentLogger,
    });

    // Should keep existing profile, only remove deploymentProfile
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.newProfile, 'operator');
    assert.strictEqual(result.configData.profile, 'operator');
    assert.strictEqual(result.configData.deploymentProfile, undefined);
  });
});

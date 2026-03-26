/**
 * Tests for the profile rollback system — backup, restore,
 * and edge cases.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  backupProfile,
  rollbackProfile,
  hasBackup,
} from './rollback.js';

describe('Profile Rollback', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hexos-rollback-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── backupProfile ──

  describe('backupProfile()', () => {

    it('creates a backup file', () => {
      backupProfile(
        { profile: 'sovereign', capabilities: { auditTrail: 'local' } },
        'operator',
        'cli',
        tempDir
      );
      assert.ok(hasBackup(tempDir));
    });

    it('returns the backup object with correct fields', () => {
      const backup = backupProfile(
        { profile: 'sovereign', capabilities: { auditTrail: 'local' } },
        'operator',
        'cli',
        tempDir
      );
      assert.strictEqual(backup.previousProfile, 'sovereign');
      assert.deepStrictEqual(backup.previousCapabilities, { auditTrail: 'local' });
      assert.strictEqual(backup.changedTo, 'operator');
      assert.strictEqual(backup.changedBy, 'cli');
      assert.ok(backup.timestamp);
    });

    it('defaults capabilities to empty object when none provided', () => {
      const backup = backupProfile(
        { profile: 'sovereign' },
        'managed',
        'api',
        tempDir
      );
      assert.deepStrictEqual(backup.previousCapabilities, {});
    });

    it('overwrites previous backup (only one level)', () => {
      backupProfile({ profile: 'sovereign' }, 'operator', 'cli', tempDir);
      backupProfile({ profile: 'operator' }, 'managed', 'api', tempDir);

      const backup = rollbackProfile(tempDir);
      assert.strictEqual(backup.previousProfile, 'operator');
      assert.strictEqual(backup.changedTo, 'managed');
    });
  });

  // ── rollbackProfile ──

  describe('rollbackProfile()', () => {

    it('reads the backup and returns previous config', () => {
      backupProfile(
        { profile: 'operator', capabilities: { costLimits: { monthlyDollars: 500 } } },
        'managed',
        'cli',
        tempDir
      );

      const backup = rollbackProfile(tempDir);
      assert.strictEqual(backup.previousProfile, 'operator');
      assert.deepStrictEqual(backup.previousCapabilities, {
        costLimits: { monthlyDollars: 500 },
      });
    });

    it('throws when no backup exists', () => {
      assert.throws(
        () => rollbackProfile(tempDir),
        /No profile backup found/
      );
    });
  });

  // ── hasBackup ──

  describe('hasBackup()', () => {

    it('returns false when no backup exists', () => {
      assert.strictEqual(hasBackup(tempDir), false);
    });

    it('returns true after backup is created', () => {
      backupProfile({ profile: 'sovereign' }, 'operator', 'cli', tempDir);
      assert.strictEqual(hasBackup(tempDir), true);
    });
  });
});

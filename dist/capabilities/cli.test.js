/**
 * Tests for Phase 3 CLI commands — profileShow, profileDiff, profileSet,
 * profileRollback, profileValidate, profileExplain.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  profileShow,
  profileDiff,
  profileSet,
  profileRollback,
  profileValidate,
  profileExplain,
  diffCapabilities,
  formatCapabilityValue,
  CAPABILITY_METADATA,
} from './cli.js';
import { resetCapabilities } from './resolver.js';
import { SOVEREIGN, OPERATOR, MANAGED, PROFILES } from './presets.js';

/** Silent logger */
const silentLogger = { info() {}, warn() {}, error() {} };

describe('CLI — profileShow', () => {
  beforeEach(() => resetCapabilities());
  afterEach(() => resetCapabilities());

  it('shows sovereign profile with correct info', () => {
    const result = profileShow({ profile: 'sovereign' }, { logger: silentLogger });
    assert.strictEqual(result.profile, 'sovereign');
    assert.strictEqual(result.overrideCount, 0);
    assert.ok(result.output.includes('Profile: sovereign'));
    assert.ok(result.output.includes('Overrides: 0'));
  });

  it('shows operator profile capabilities grouped by layer', () => {
    const result = profileShow({ profile: 'operator' }, { logger: silentLogger });
    assert.ok(result.output.includes('Execution:'));
    assert.ok(result.output.includes('Self-Modification:'));
    assert.ok(result.output.includes('Agents:'));
    assert.ok(result.output.includes('Guardrails:'));
    assert.ok(result.output.includes('Infrastructure:'));
  });

  it('reports override count correctly', () => {
    const result = profileShow({
      profile: 'sovereign',
      capabilities: { auditTrail: 'local', leakScanner: true },
    }, { logger: silentLogger });
    assert.strictEqual(result.overrideCount, 2);
    assert.ok(result.output.includes('Overrides: 2'));
  });

  it('shows managed profile exec as disabled', () => {
    const result = profileShow({ profile: 'managed' }, { logger: silentLogger });
    assert.ok(result.output.includes('disabled'));
  });

  it('shows human-readable values (not raw JSON)', () => {
    const result = profileShow({ profile: 'sovereign' }, { logger: silentLogger });
    // Should show 'yes'/'no' for booleans, not 'true'/'false'
    assert.ok(result.output.includes('yes'));
    // Should show 'unlimited' for agentConcurrency -1
    assert.ok(result.output.includes('unlimited'));
  });
});

describe('CLI — profileDiff', () => {

  it('shows differences between sovereign and managed', () => {
    const result = profileDiff('sovereign', 'managed');
    assert.ok(result.diffs.length > 0);
    assert.ok(result.output.includes('→'));
  });

  it('shows exec.mode difference between sovereign and operator', () => {
    const result = profileDiff('sovereign', 'operator');
    const execDiff = result.diffs.find(d => d.key === 'exec.mode');
    assert.ok(execDiff, 'Should have exec.mode diff');
    assert.strictEqual(execDiff.value1, 'unrestricted');
    assert.strictEqual(execDiff.value2, 'allowlist');
  });

  it('skips identical capabilities', () => {
    const result = profileDiff('sovereign', 'operator');
    // workspaceEdit is true in both — should not appear
    const wsEdit = result.diffs.find(d => d.key === 'workspaceEdit');
    assert.strictEqual(wsEdit, undefined, 'workspaceEdit should not differ');
  });

  it('throws on unknown profile name', () => {
    assert.throws(
      () => profileDiff('sovereign', 'invalid'),
      /Unknown profile: "invalid"/
    );
  });

  it('returns empty diffs for same profile', () => {
    const result = profileDiff('sovereign', 'sovereign');
    assert.strictEqual(result.diffs.length, 0);
    assert.ok(result.output.includes('No differences'));
  });

  it('diffs structured costLimits fields individually', () => {
    const result = profileDiff('sovereign', 'operator');
    const monthlyDiff = result.diffs.find(d => d.key === 'costLimits.monthlyDollars');
    assert.ok(monthlyDiff, 'Should diff costLimits.monthlyDollars');
  });
});

describe('CLI — profileSet', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hexos-cli-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetCapabilities();
  });

  it('creates a backup and returns diff', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({ profile: 'sovereign' }, null, 2));

    const result = profileSet('operator', {
      configPath,
      backupDir: tempDir,
      logger: silentLogger,
    });

    assert.ok(result.backup);
    assert.strictEqual(result.backup.previousProfile, 'sovereign');
    assert.strictEqual(result.backup.changedTo, 'operator');
    assert.ok(result.diffs.length > 0);
    assert.ok(result.output.includes('Backup saved'));
    assert.ok(result.output.includes('Restart required'));
  });

  it('writes new profile to config file', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({ profile: 'sovereign' }, null, 2));

    profileSet('operator', {
      configPath,
      backupDir: tempDir,
      logger: silentLogger,
    });

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(updated.profile, 'operator');
  });

  it('returns no-op when already on target profile', () => {
    const result = profileSet('sovereign', {
      currentConfig: { profile: 'sovereign' },
      backupDir: tempDir,
      logger: silentLogger,
    });
    assert.strictEqual(result.backup, null);
    assert.strictEqual(result.diffs.length, 0);
    assert.ok(result.output.includes('Already on profile'));
  });

  it('throws on unknown profile', () => {
    assert.throws(
      () => profileSet('custom', { currentConfig: { profile: 'sovereign' }, backupDir: tempDir }),
      /Unknown profile: "custom"/
    );
  });
});

describe('CLI — profileRollback', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hexos-rollback-cli-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetCapabilities();
  });

  it('restores previous profile from backup', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({ profile: 'sovereign' }, null, 2));

    // First set to operator (creates backup)
    profileSet('operator', { configPath, backupDir: tempDir, logger: silentLogger });

    // Then rollback
    const result = profileRollback({ configPath, backupDir: tempDir, logger: silentLogger });

    assert.ok(result.output.includes('sovereign'));
    assert.ok(result.output.includes('Restart required'));

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.profile, 'sovereign');
  });

  it('throws when no backup exists', () => {
    assert.throws(
      () => profileRollback({ backupDir: tempDir, logger: silentLogger }),
      /No profile backup found/
    );
  });

  it('restores capability overrides from backup', () => {
    const configPath = join(tempDir, 'hexos.json');
    writeFileSync(configPath, JSON.stringify({
      profile: 'sovereign',
      capabilities: { auditTrail: 'local' },
    }, null, 2));

    profileSet('managed', { configPath, backupDir: tempDir, logger: silentLogger });
    profileRollback({ configPath, backupDir: tempDir, logger: silentLogger });

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.profile, 'sovereign');
    assert.deepStrictEqual(config.capabilities, { auditTrail: 'local' });
  });
});

describe('CLI — profileValidate', () => {

  it('reports valid config', () => {
    const result = profileValidate({ profile: 'sovereign' }, { logger: silentLogger });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.output.includes('✅'));
  });

  it('reports invalid profile name', () => {
    const result = profileValidate({ profile: 'custom' }, { logger: silentLogger });
    assert.strictEqual(result.valid, false);
    assert.ok(result.output.includes('❌'));
  });

  it('reports escalation errors', () => {
    const result = profileValidate({
      profile: 'managed',
      capabilities: { exec: { mode: 'unrestricted' } },
    }, { logger: silentLogger });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('escalate')));
  });

  it('reports override count', () => {
    const result = profileValidate({
      profile: 'sovereign',
      capabilities: { auditTrail: 'local' },
    }, { logger: silentLogger });
    assert.strictEqual(result.overrideCount, 1);
  });

  it('warns about auditTrail=local without auditDir', () => {
    const result = profileValidate({
      profile: 'sovereign',
      capabilities: { auditTrail: 'local' },
    }, { logger: silentLogger });
    assert.ok(result.warnings.some(w => w.includes('auditDir')));
  });
});

describe('CLI — profileExplain', () => {

  it('shows capability description and layer', () => {
    const result = profileExplain(null, 'exec');
    assert.ok(result.output.includes('Shell command execution'));
    assert.ok(result.output.includes('Layer: Execution'));
  });

  it('shows possible values for enum capability', () => {
    const result = profileExplain(null, 'fileSystem');
    assert.ok(result.output.includes('full'));
    assert.ok(result.output.includes('workspace-only'));
    assert.ok(result.output.includes('read-only'));
  });

  it('shows per-profile defaults', () => {
    const result = profileExplain(null, 'exec');
    assert.ok(result.output.includes('sovereign'));
    assert.ok(result.output.includes('operator'));
    assert.ok(result.output.includes('managed'));
  });

  it('shows current resolved value when config provided', () => {
    const result = profileExplain({ profile: 'sovereign', capabilities: { auditTrail: 'local' } }, 'auditTrail');
    assert.ok(result.output.includes('local'));
    assert.ok(result.output.includes('Current value'));
  });

  it('throws on unknown capability', () => {
    assert.throws(
      () => profileExplain(null, 'unknownCap'),
      /Unknown capability: "unknownCap"/
    );
  });

  it('shows override rules per profile', () => {
    const result = profileExplain(null, 'selfUpdate');
    assert.ok(result.output.includes('Override rules:'));
    assert.ok(result.output.includes('sovereign'));
  });
});

describe('CLI — formatCapabilityValue', () => {

  it('formats booleans as yes/no', () => {
    assert.strictEqual(formatCapabilityValue('selfUpdate', true), 'yes');
    assert.strictEqual(formatCapabilityValue('selfUpdate', false), 'no');
  });

  it('formats agentConcurrency -1 as unlimited', () => {
    assert.strictEqual(formatCapabilityValue('agentConcurrency', -1), 'unlimited');
  });

  it('formats arrays as comma-separated', () => {
    assert.strictEqual(formatCapabilityValue('agentToolProfiles', ['full', 'coding']), 'full, coding');
  });

  it('formats exec allowlist', () => {
    const val = formatCapabilityValue('exec', { mode: 'allowlist', allowlist: ['git', 'npm'] });
    assert.ok(val.includes('allowlist'));
    assert.ok(val.includes('git'));
  });

  it('formats costLimits', () => {
    const val = formatCapabilityValue('costLimits', {
      monthlyDollars: 1000,
      perSessionDollars: 50,
      perTaskDollars: 10,
      alertAtPercent: 80,
    });
    assert.ok(val.includes('$1000/mo'));
    assert.ok(val.includes('$50/session'));
  });
});

describe('CLI — diffCapabilities', () => {

  it('returns empty array for identical sets', () => {
    const diffs = diffCapabilities(SOVEREIGN, SOVEREIGN);
    assert.strictEqual(diffs.length, 0);
  });

  it('detects all differences between sovereign and managed', () => {
    const diffs = diffCapabilities(SOVEREIGN, MANAGED);
    assert.ok(diffs.length > 10, `Expected >10 diffs, got ${diffs.length}`);
  });
});

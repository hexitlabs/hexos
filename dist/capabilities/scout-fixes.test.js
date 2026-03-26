/**
 * Tests for Scout review fixes — frozen exports, trust boundary,
 * migration edge case, and parameter order consistency.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  checkApproval,
  ApprovalRequiredError,
  drainAuditEvents,
} from './approval.js';
import { CAPABILITY_KEYS, STRUCTURED_CAPABILITY_KEYS, ARRAY_CAPABILITY_KEYS } from './types.js';
import { SOVEREIGN, OPERATOR, MANAGED, PROFILES } from './presets.js';
import { initCapabilities, resetCapabilities } from './resolver.js';
import { migrateProfile } from './migration.js';
import { profileExplain, profileShow, profileValidate } from './cli.js';

const silentLogger = { info() {}, warn() {}, error() {} };

// ── Security Fix 1: Frozen exported arrays ──

describe('Scout Fix: Frozen exported arrays', () => {

  it('EXTERNAL_ACTIONS cannot be modified via push()', () => {
    const originalLength = EXTERNAL_ACTIONS.length;
    assert.throws(
      () => EXTERNAL_ACTIONS.push('malicious.action'),
      TypeError,
    );
    assert.strictEqual(EXTERNAL_ACTIONS.length, originalLength);
  });

  it('EXTERNAL_ACTIONS cannot be modified via splice()', () => {
    assert.throws(
      () => EXTERNAL_ACTIONS.splice(0, 1),
      TypeError,
    );
  });

  it('DESTRUCTIVE_ACTIONS cannot be modified via push()', () => {
    const originalLength = DESTRUCTIVE_ACTIONS.length;
    assert.throws(
      () => DESTRUCTIVE_ACTIONS.push('malicious.destroy'),
      TypeError,
    );
    assert.strictEqual(DESTRUCTIVE_ACTIONS.length, originalLength);
  });

  it('CAPABILITY_KEYS cannot be modified', () => {
    assert.throws(
      () => CAPABILITY_KEYS.push('evilKey'),
      TypeError,
    );
  });

  it('STRUCTURED_CAPABILITY_KEYS cannot be modified', () => {
    assert.throws(
      () => STRUCTURED_CAPABILITY_KEYS.push('evilKey'),
      TypeError,
    );
  });

  it('ARRAY_CAPABILITY_KEYS cannot be modified', () => {
    assert.throws(
      () => ARRAY_CAPABILITY_KEYS.push('evilKey'),
      TypeError,
    );
  });
});

// ── Security Fix 2: Frozen preset objects ──

describe('Scout Fix: Frozen preset objects', () => {

  it('SOVEREIGN preset cannot have properties added', () => {
    assert.throws(
      () => { SOVEREIGN.evilCap = true; },
      TypeError,
    );
  });

  it('SOVEREIGN preset cannot have properties modified', () => {
    assert.throws(
      () => { SOVEREIGN.selfUpdate = false; },
      TypeError,
    );
  });

  it('SOVEREIGN nested objects are frozen (deep freeze)', () => {
    assert.throws(
      () => { SOVEREIGN.exec.mode = 'disabled'; },
      TypeError,
    );
    assert.throws(
      () => { SOVEREIGN.costLimits.monthlyDollars = 0; },
      TypeError,
    );
  });

  it('OPERATOR preset cannot be mutated', () => {
    assert.throws(
      () => { OPERATOR.selfUpdate = true; },
      TypeError,
    );
    assert.throws(
      () => { OPERATOR.exec.mode = 'unrestricted'; },
      TypeError,
    );
  });

  it('MANAGED preset cannot be mutated', () => {
    assert.throws(
      () => { MANAGED.agentSpawn = 'unlimited'; },
      TypeError,
    );
    assert.throws(
      () => { MANAGED.approvalGates.mode = 'none'; },
      TypeError,
    );
  });

  it('PROFILES record cannot be mutated', () => {
    assert.throws(
      () => { PROFILES.evil = {}; },
      TypeError,
    );
    assert.throws(
      () => { PROFILES.sovereign = {}; },
      TypeError,
    );
  });
});

// ── Security Fix 3: Trust boundary for context.scheduled ──

describe('Scout Fix: Managed profile scheduled trust boundary', () => {

  beforeEach(() => {
    resetCapabilities();
    drainAuditEvents();
  });

  it('managed profile rejects scheduled=true without cronJobId', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    const ctx = { scheduled: true, sessionId: 'test-session' };

    // Without cronJobId, managed should NOT bypass — should throw
    assert.throws(
      () => checkApproval('email.send', ctx),
      (err) => err instanceof ApprovalRequiredError,
    );
  });

  it('managed profile rejects scheduled=true with empty cronJobId', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    const ctx = { scheduled: true, cronJobId: '', sessionId: 'test-session' };

    assert.throws(
      () => checkApproval('email.send', ctx),
      (err) => err instanceof ApprovalRequiredError,
    );
  });

  it('managed profile rejects scheduled=true with whitespace-only cronJobId', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    const ctx = { scheduled: true, cronJobId: '   ', sessionId: 'test-session' };

    assert.throws(
      () => checkApproval('email.send', ctx),
      (err) => err instanceof ApprovalRequiredError,
    );
  });

  it('managed profile allows scheduled bypass with valid cronJobId', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    const ctx = { scheduled: true, cronJobId: 'cron-daily-report', sessionId: 'test-session' };

    const result = checkApproval('email.send', ctx);
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.reason, 'bypassed');
  });

  it('sovereign profile allows scheduled bypass without cronJobId (trusted)', () => {
    initCapabilities({ profile: 'sovereign', capabilities: { approvalGates: { mode: 'all' } } }, { logger: silentLogger });
    const ctx = { scheduled: true, sessionId: 'test-session' };

    const result = checkApproval('email.send', ctx);
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.reason, 'bypassed');
  });

  it('operator profile allows scheduled bypass without cronJobId (trusted)', () => {
    initCapabilities({ profile: 'operator' }, { logger: silentLogger });
    const ctx = { scheduled: true, sessionId: 'test-session' };

    const result = checkApproval('email.send', ctx);
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.reason, 'bypassed');
  });
});

// ── Bug Fix 1: Migration when both profile and deploymentProfile exist ──

describe('Scout Fix: Migration with both profile and deploymentProfile', () => {

  it('keeps existing profile when both fields present', () => {
    const result = migrateProfile({
      configData: { profile: 'operator', deploymentProfile: 'managed', model: 'claude' },
      logger: silentLogger,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.newProfile, 'operator');
    assert.strictEqual(result.configData.profile, 'operator');
    assert.strictEqual(result.configData.deploymentProfile, undefined);
    // Other fields preserved
    assert.strictEqual(result.configData.model, 'claude');
  });

  it('does not overwrite profile with mapped deploymentProfile value', () => {
    const result = migrateProfile({
      configData: { profile: 'managed', deploymentProfile: 'operator' },
      logger: silentLogger,
    });

    // profile should remain 'managed', NOT be overwritten by the mapped 'sovereign'
    assert.strictEqual(result.configData.profile, 'managed');
    assert.strictEqual(result.configData.deploymentProfile, undefined);
  });

  it('logs the correct message when both fields present', () => {
    const infos = [];
    const logger = { info(m) { infos.push(m); }, warn() {}, error() {} };

    migrateProfile({
      configData: { profile: 'operator', deploymentProfile: 'managed' },
      logger,
    });

    assert.ok(
      infos.some(m => m.includes('Both profile and deploymentProfile found')),
      'Should log message about both fields',
    );
  });
});

// ── Bug Fix 2: profileExplain parameter order ──

describe('Scout Fix: profileExplain parameter order matches other CLI functions', () => {

  it('profileExplain(config, key) follows config-first pattern like profileShow/profileValidate', () => {
    // profileShow signature: profileShow(config, options)
    // profileValidate signature: profileValidate(config, options)
    // profileExplain should be: profileExplain(config, capabilityKey, options)

    // Call with config first, key second
    const result = profileExplain({ profile: 'operator' }, 'exec');
    assert.ok(result.output.includes('Shell command execution'));
    assert.ok(result.output.includes('Current value'));
    assert.ok(result.output.includes('allowlist'));
  });

  it('profileExplain works with null config (no resolved value shown)', () => {
    const result = profileExplain(null, 'exec');
    assert.ok(result.output.includes('Shell command execution'));
    assert.ok(!result.output.includes('Current value'));
  });

  it('profileExplain throws on unknown capability with config-first calling', () => {
    assert.throws(
      () => profileExplain(null, 'unknownCap'),
      /Unknown capability: "unknownCap"/,
    );
  });
});

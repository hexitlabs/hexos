/**
 * Integration tests — end-to-end flows across the capability system.
 * Tests the full lifecycle: init → override → gate check → denial → metrics.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initCapabilities,
  getCapability,
  requireCapability,
  resetCapabilities,
  getResolvedProfile,
} from './resolver.js';
import { CapabilityDeniedError } from './errors.js';
import { checkApproval, ApprovalRequiredError, drainAuditEvents } from './approval.js';
import {
  trackLLMCost,
  getCostProvider,
  setCostProvider,
  InMemoryCostProvider,
  CostLimitExceededError,
  drainAlerts,
} from './cost.js';
import { recordCheck, getCounter, resetMetrics } from './metrics.js';
import { resolveChildCapabilities, CapabilityEscalationError } from './inheritance.js';
import { profileShow, profileDiff, profileValidate, profileExplain } from './cli.js';
import { migrateProfile } from './migration.js';
import { OPERATOR } from './presets.js';

/** Silent logger */
const silentLogger = { info() {}, warn() {}, error() {} };

describe('Integration — Init → Override → Gate → Denial → Metrics', () => {

  beforeEach(() => {
    resetCapabilities();
    resetMetrics();
    setCostProvider(new InMemoryCostProvider());
    drainAlerts();
    drainAuditEvents();
  });

  it('sovereign allows unrestricted exec, records metric', () => {
    initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });

    // Gate check should pass
    requireCapability('exec', 'unrestricted', 'shell.execute');
    recordCheck('exec', 'shell.execute', 'sovereign', 'allowed');

    assert.strictEqual(
      getCounter('hexos_capability_checks_total', {
        capability: 'exec', action: 'shell.execute', profile: 'sovereign', result: 'allowed',
      }),
      1
    );
  });

  it('managed denies exec and records denial metric', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });

    assert.throws(
      () => requireCapability('exec', 'unrestricted', 'shell.execute'),
      (err) => {
        assert.ok(err instanceof CapabilityDeniedError);
        return true;
      }
    );

    recordCheck('exec', 'shell.execute', 'managed', 'denied');
    assert.strictEqual(
      getCounter('hexos_capability_denied_total', {
        capability: 'exec', action: 'shell.execute', profile: 'managed',
      }),
      1
    );
  });

  it('operator enforces approval gates for external actions', () => {
    initCapabilities({ profile: 'operator' }, { logger: silentLogger });

    assert.throws(
      () => checkApproval('message.send', { scheduled: false, sessionId: 'test-1' }),
      (err) => {
        assert.ok(err instanceof ApprovalRequiredError);
        assert.strictEqual(err.category, 'external');
        return true;
      }
    );
  });

  it('operator cost limits trigger alert and hard limit', () => {
    initCapabilities({ profile: 'operator' }, { logger: silentLogger });

    // Operator limits: $1000/mo (alert@80%=$800), $50/session, $10/task
    // Use $5 per call with unique session+task to stay under session/task limits
    for (let i = 0; i < 161; i++) {
      trackLLMCost({
        model: 'claude', inputTokens: 100, outputTokens: 50,
        costDollars: 5, purpose: 'test', sessionId: `s${i}`, taskId: `t${i}`,
        timestamp: Date.now(),
      });
    }
    // Monthly total: $805

    // Collect all alerts — look for a monthly one among them
    const alerts = drainAlerts();
    const monthlyAlert = alerts.find(a => a.period === 'monthly');
    assert.ok(monthlyAlert, `Should have triggered monthly alert. Got: ${alerts.map(a => a.period).join(', ')}`);

    // Spend past monthly limit
    assert.throws(
      () => trackLLMCost({
        model: 'claude', inputTokens: 1000, outputTokens: 500,
        costDollars: 200, purpose: 'test', sessionId: 's-final', taskId: 't-final',
        timestamp: Date.now(),
      }),
      (err) => {
        assert.ok(err instanceof CostLimitExceededError);
        return true;
      }
    );
  });

  it('child agent cannot escalate beyond parent capabilities', () => {
    initCapabilities({ profile: 'operator' }, { logger: silentLogger });

    // Build full operator caps from preset
    const operatorCaps = { ...OPERATOR };

    // Try to spawn sovereign child — should be clamped
    const childCaps = resolveChildCapabilities(
      operatorCaps, 'sovereign', {}, 'profile-default'
    );

    // Child should be clamped to operator's level
    assert.notStrictEqual(childCaps.exec.mode, 'unrestricted',
      'Child exec should be clamped (not unrestricted)');
  });

  it('full lifecycle: init → show → validate → diff → explain', () => {
    // Show
    const showResult = profileShow({ profile: 'operator' }, { logger: silentLogger });
    assert.ok(showResult.output.includes('operator'));

    // Validate
    const validateResult = profileValidate({ profile: 'operator' }, { logger: silentLogger });
    assert.strictEqual(validateResult.valid, true);

    // Diff
    const diffResult = profileDiff('operator', 'managed');
    assert.ok(diffResult.diffs.length > 0);

    // Explain
    const explainResult = profileExplain({ profile: 'operator' }, 'exec');
    assert.ok(explainResult.output.includes('allowlist'));
  });

  it('migration + validation round-trip', () => {
    // Migrate from legacy
    const migrateResult = migrateProfile({
      configData: { deploymentProfile: 'operator', model: 'claude' },
      logger: silentLogger,
    });
    assert.strictEqual(migrateResult.success, true);
    assert.strictEqual(migrateResult.newProfile, 'sovereign');

    // Validate the migrated config
    const validateResult = profileValidate(
      { profile: migrateResult.newProfile },
      { logger: silentLogger }
    );
    assert.strictEqual(validateResult.valid, true);
  });

  it('scheduled task bypasses approval in managed mode', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });

    // Non-scheduled action should be blocked (mode: 'all')
    assert.throws(
      () => checkApproval('file.delete', { scheduled: false, sessionId: 's1' }),
      (err) => err instanceof ApprovalRequiredError
    );

    // Scheduled action should be bypassed
    const result = checkApproval('file.delete', {
      scheduled: true,
      cronJobId: 'cron-1',
      sessionId: 's1',
    });
    assert.strictEqual(result.approved, true);
    assert.strictEqual(result.reason, 'bypassed');
  });
});

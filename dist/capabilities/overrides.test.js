/**
 * Tests for override restriction enforcement — verifies that profiles
 * can opt INTO restrictions but not OUT of them (PRD §4.3).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initCapabilities, resetCapabilities, validateOverrides } from './resolver.js';

/** Silent logger */
const silentLogger = { info() {}, warn() {}, error() {} };

describe('Override Restrictions', () => {

  beforeEach(() => {
    resetCapabilities();
  });

  // ── Sovereign: Can Add Restrictions ──

  describe('Sovereign → can opt INTO restrictions', () => {
    it('can restrict exec to allowlist', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { exec: { mode: 'allowlist', allowlist: ['git'] } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.exec.mode, 'allowlist');
    });

    it('can disable exec entirely', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { exec: { mode: 'disabled' } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.exec.mode, 'disabled');
    });

    it('can enable audit trail', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { auditTrail: 'local' } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.auditTrail, 'local');
    });

    it('can add cost limits', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { costLimits: { monthlyDollars: 500 } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.costLimits.monthlyDollars, 500);
    });

    it('can disable selfUpdate', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { selfUpdate: false } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.selfUpdate, false);
    });

    it('can restrict browser to sandboxed', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { browser: { mode: 'sandboxed' } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.browser.mode, 'sandboxed');
    });

    it('can restrict network to egress-controlled', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { network: 'egress-controlled' } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.network, 'egress-controlled');
    });

    it('can restrict agentConcurrency', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { agentConcurrency: 5 } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.agentConcurrency, 5);
    });

    it('can restrict agentToolProfiles to subset', () => {
      const result = initCapabilities(
        { profile: 'sovereign', capabilities: { agentToolProfiles: ['minimal'] } },
        { logger: silentLogger }
      );
      assert.deepStrictEqual(result.capabilities.agentToolProfiles, ['minimal']);
    });
  });

  // ── Operator: Cannot Escalate ──

  describe('Operator → cannot escalate', () => {
    it('cannot set exec to unrestricted', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { exec: { mode: 'unrestricted' } } },
          { logger: silentLogger }
        ),
        /Cannot escalate exec.mode/
      );
    });

    it('cannot enable selfUpdate', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { selfUpdate: true } },
          { logger: silentLogger }
        ),
        /Cannot escalate selfUpdate/
      );
    });

    it('cannot enable codeModification', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { codeModification: true } },
          { logger: silentLogger }
        ),
        /Cannot escalate codeModification/
      );
    });

    it('cannot disable audit trail', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { auditTrail: 'disabled' } },
          { logger: silentLogger }
        ),
        /Cannot escalate auditTrail/
      );
    });

    it('cannot increase cost limits', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { costLimits: { monthlyDollars: 5000 } } },
          { logger: silentLogger }
        ),
        /Cannot increase monthlyDollars/
      );
    });

    it('cannot remove cost limits', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { costLimits: { monthlyDollars: null } } },
          { logger: silentLogger }
        ),
        /Cannot remove monthlyDollars/
      );
    });

    it('cannot set browser to full', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { browser: { mode: 'full' } } },
          { logger: silentLogger }
        ),
        /Cannot escalate browser.mode/
      );
    });

    it('can lower cost limits', () => {
      const result = initCapabilities(
        { profile: 'operator', capabilities: { costLimits: { monthlyDollars: 500 } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.costLimits.monthlyDollars, 500);
    });

    it('can disable exec (more restrictive)', () => {
      const result = initCapabilities(
        { profile: 'operator', capabilities: { exec: { mode: 'disabled' } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.exec.mode, 'disabled');
    });

    it('cannot increase agentConcurrency', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { agentConcurrency: 50 } },
          { logger: silentLogger }
        ),
        /Cannot increase agentConcurrency/
      );
    });

    it('cannot relax approval gates', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { approvalGates: { mode: 'none' } } },
          { logger: silentLogger }
        ),
        /Cannot relax approvalGates.mode/
      );
    });

    it('cannot increase alertAtPercent', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'operator', capabilities: { costLimits: { alertAtPercent: 95 } } },
          { logger: silentLogger }
        ),
        /Cannot increase alertAtPercent/
      );
    });
  });

  // ── Managed: Maximum Lockdown ──

  describe('Managed → cannot remove restrictions', () => {
    it('cannot enable exec', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { exec: { mode: 'allowlist' } } },
          { logger: silentLogger }
        ),
        /Cannot escalate exec.mode/
      );
    });

    it('cannot enable browser', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { browser: { mode: 'sandboxed' } } },
          { logger: silentLogger }
        ),
        /Cannot escalate browser.mode/
      );
    });

    it('cannot enable agent spawning', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { agentSpawn: 'budget-limited' } },
          { logger: silentLogger }
        ),
        /Cannot escalate agentSpawn/
      );
    });

    it('cannot enable channel bindings', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { channelBindings: true } },
          { logger: silentLogger }
        ),
        /Cannot escalate channelBindings/
      );
    });

    it('cannot disable leak scanner', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { leakScanner: false } },
          { logger: silentLogger }
        ),
        /Cannot disable leakScanner/
      );
    });

    it('cannot increase cost limits', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { costLimits: { monthlyDollars: 500 } } },
          { logger: silentLogger }
        ),
        /Cannot increase monthlyDollars/
      );
    });

    it('cannot enable external agent comms', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { externalAgentComms: 'authenticated-only' } },
          { logger: silentLogger }
        ),
        /Cannot escalate externalAgentComms/
      );
    });

    it('can lower cost limits (more restrictive)', () => {
      const result = initCapabilities(
        { profile: 'managed', capabilities: { costLimits: { monthlyDollars: 50, perSessionDollars: 2 } } },
        { logger: silentLogger }
      );
      assert.strictEqual(result.capabilities.costLimits.monthlyDollars, 50);
      assert.strictEqual(result.capabilities.costLimits.perSessionDollars, 2);
    });

    it('cannot add tool profiles not in preset', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { agentToolProfiles: ['full'] } },
          { logger: silentLogger }
        ),
        /Cannot add tool profile "full"/
      );
    });

    it('cannot set agentConcurrency to unlimited', () => {
      assert.throws(
        () => initCapabilities(
          { profile: 'managed', capabilities: { agentConcurrency: -1 } },
          { logger: silentLogger }
        ),
        /Cannot set agentConcurrency to unlimited/
      );
    });
  });

  // ── validateOverrides directly ──

  describe('validateOverrides()', () => {
    it('returns empty errors for valid sovereign override', () => {
      const { errors } = validateOverrides('sovereign', { auditTrail: 'local' });
      assert.strictEqual(errors.length, 0);
    });

    it('returns errors for invalid escalation', () => {
      const { errors } = validateOverrides('managed', { exec: { mode: 'unrestricted' } });
      assert.ok(errors.length > 0);
    });

    it('returns warnings for unknown keys', () => {
      const { warnings } = validateOverrides('sovereign', { futureCapability: true });
      assert.ok(warnings.length > 0);
      assert.ok(warnings[0].includes('futureCapability'));
    });

    it('returns error for unknown profile', () => {
      const { errors } = validateOverrides('nonexistent', {});
      assert.ok(errors.length > 0);
      assert.ok(errors[0].includes('Unknown profile'));
    });
  });
});

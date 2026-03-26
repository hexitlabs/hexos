/**
 * Tests for multi-agent capability inheritance — 3 modes,
 * escalation prevention, and edge cases.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveChildCapabilities,
  validateNoEscalation,
  isEscalation,
  CapabilityEscalationError,
} from './inheritance.js';
import { SOVEREIGN, OPERATOR, MANAGED } from './presets.js';

describe('Multi-Agent Capability Inheritance', () => {

  // ── isEscalation ──

  describe('isEscalation()', () => {

    it('detects exec mode escalation', () => {
      assert.strictEqual(isEscalation('exec', { mode: 'allowlist' }, { mode: 'unrestricted' }), true);
      assert.strictEqual(isEscalation('exec', { mode: 'allowlist' }, { mode: 'disabled' }), false);
      assert.strictEqual(isEscalation('exec', { mode: 'allowlist' }, { mode: 'allowlist' }), false);
    });

    it('detects exec allowlist escalation', () => {
      const parent = { mode: 'allowlist', allowlist: ['git', 'npm'] };
      const childOk = { mode: 'allowlist', allowlist: ['git'] };
      const childBad = { mode: 'allowlist', allowlist: ['git', 'npm', 'docker'] };

      assert.strictEqual(isEscalation('exec', parent, childOk), false);
      assert.strictEqual(isEscalation('exec', parent, childBad), true);
    });

    it('detects boolean permissive cap escalation', () => {
      assert.strictEqual(isEscalation('selfUpdate', false, true), true);
      assert.strictEqual(isEscalation('selfUpdate', true, false), false);
      assert.strictEqual(isEscalation('selfUpdate', true, true), false);
    });

    it('detects boolean security cap escalation', () => {
      assert.strictEqual(isEscalation('leakScanner', true, false), true);
      assert.strictEqual(isEscalation('leakScanner', false, true), false);
    });

    it('detects agentConcurrency escalation', () => {
      assert.strictEqual(isEscalation('agentConcurrency', 20, 50), true);
      assert.strictEqual(isEscalation('agentConcurrency', 20, -1), true);
      assert.strictEqual(isEscalation('agentConcurrency', 20, 10), false);
      assert.strictEqual(isEscalation('agentConcurrency', -1, 100), false);
    });

    it('detects agentToolProfiles escalation', () => {
      assert.strictEqual(
        isEscalation('agentToolProfiles', ['coding', 'minimal'], ['coding', 'minimal', 'full']),
        true
      );
      assert.strictEqual(
        isEscalation('agentToolProfiles', ['full', 'coding', 'minimal'], ['coding']),
        false
      );
    });

    it('detects costLimits escalation (raise limit)', () => {
      const parent = { monthlyDollars: 100, perSessionDollars: 5, perTaskDollars: 2, alertAtPercent: 70 };
      const childHigher = { monthlyDollars: 200, perSessionDollars: 5, perTaskDollars: 2, alertAtPercent: 70 };
      assert.strictEqual(isEscalation('costLimits', parent, childHigher), true);
    });

    it('detects costLimits escalation (remove limit)', () => {
      const parent = { monthlyDollars: 100, perSessionDollars: 5, perTaskDollars: 2, alertAtPercent: 70 };
      const childNull = { monthlyDollars: null, perSessionDollars: 5, perTaskDollars: 2, alertAtPercent: 70 };
      assert.strictEqual(isEscalation('costLimits', parent, childNull), true);
    });

    it('allows costLimits restriction (lower limit)', () => {
      const parent = { monthlyDollars: 100, perSessionDollars: 5, perTaskDollars: 2, alertAtPercent: 70 };
      const childLower = { monthlyDollars: 50, perSessionDollars: 3, perTaskDollars: 1, alertAtPercent: 60 };
      assert.strictEqual(isEscalation('costLimits', parent, childLower), false);
    });

    it('detects costLimits alertAtPercent escalation', () => {
      const parent = { monthlyDollars: 100, alertAtPercent: 70 };
      const child = { monthlyDollars: 100, alertAtPercent: 90 };
      assert.strictEqual(isEscalation('costLimits', parent, child), true);
    });

    it('detects approvalGates mode escalation', () => {
      assert.strictEqual(
        isEscalation('approvalGates', { mode: 'all', bypassScheduled: true }, { mode: 'none', bypassScheduled: true }),
        true
      );
    });

    it('detects approvalGates bypassScheduled escalation', () => {
      assert.strictEqual(
        isEscalation('approvalGates', { mode: 'all', bypassScheduled: false }, { mode: 'all', bypassScheduled: true }),
        true
      );
    });

    it('does not flag agentCapabilityInheritance as escalation', () => {
      assert.strictEqual(isEscalation('agentCapabilityInheritance', 'profile-default', 'inherit'), false);
      assert.strictEqual(isEscalation('agentCapabilityInheritance', 'inherit', 'explicit'), false);
    });
  });

  // ── validateNoEscalation ──

  describe('validateNoEscalation()', () => {

    it('passes when child is more restrictive than parent', () => {
      assert.doesNotThrow(() => {
        validateNoEscalation(SOVEREIGN, MANAGED);
      });
    });

    it('passes when child equals parent', () => {
      assert.doesNotThrow(() => {
        validateNoEscalation(OPERATOR, OPERATOR);
      });
    });

    it('throws on escalation from managed to sovereign', () => {
      assert.throws(
        () => validateNoEscalation(MANAGED, SOVEREIGN),
        (err) => {
          assert.ok(err instanceof CapabilityEscalationError);
          return true;
        }
      );
    });

    it('throws with descriptive error on escalation', () => {
      const parent = { ...MANAGED };
      const child = { ...MANAGED, selfUpdate: true };

      assert.throws(
        () => validateNoEscalation(parent, child),
        (err) => {
          assert.ok(err instanceof CapabilityEscalationError);
          assert.strictEqual(err.capability, 'selfUpdate');
          assert.ok(err.message.includes('selfUpdate'));
          return true;
        }
      );
    });
  });

  // ── resolveChildCapabilities ──

  describe('resolveChildCapabilities()', () => {

    // ── Inherit Mode ──

    describe('mode: inherit', () => {

      it('child inherits parent caps', () => {
        const child = resolveChildCapabilities(SOVEREIGN, 'sovereign', {}, 'inherit');
        assert.strictEqual(child.exec.mode, 'unrestricted');
        assert.strictEqual(child.selfUpdate, true);
      });

      it('inherited caps never exceed parent', () => {
        const child = resolveChildCapabilities(OPERATOR, 'sovereign', {}, 'inherit');
        // Even though child requests sovereign, it can't exceed operator
        assert.doesNotThrow(() => validateNoEscalation(OPERATOR, child));
      });
    });

    // ── Profile Default Mode ──

    describe('mode: profile-default', () => {

      it('child gets its own profile defaults', () => {
        const child = resolveChildCapabilities(SOVEREIGN, 'managed', {}, 'profile-default');
        assert.strictEqual(child.exec.mode, 'disabled');
        assert.strictEqual(child.agentSpawn, 'disabled');
      });

      it('child is clamped to parent if child preset exceeds parent', () => {
        // Operator parent, child requests sovereign defaults
        const child = resolveChildCapabilities(OPERATOR, 'sovereign', {}, 'profile-default');
        // Sovereign default exec=unrestricted, but operator has allowlist
        // So child should be clamped to operator's level
        assert.doesNotThrow(() => validateNoEscalation(OPERATOR, child));
      });

      it('managed child under sovereign parent uses managed defaults', () => {
        const child = resolveChildCapabilities(SOVEREIGN, 'managed', {}, 'profile-default');
        assert.strictEqual(child.exec.mode, 'disabled');
        assert.strictEqual(child.browser.mode, 'disabled');
        assert.strictEqual(child.selfUpdate, false);
      });
    });

    // ── Explicit Mode ──

    describe('mode: explicit', () => {

      it('accepts valid overrides within parent caps', () => {
        const overrides = { agentConcurrency: 5 };
        const child = resolveChildCapabilities(OPERATOR, 'managed', overrides, 'explicit');
        assert.strictEqual(child.agentConcurrency, 5);
      });

      it('throws on escalation attempt', () => {
        const overrides = { selfUpdate: true };
        assert.throws(
          () => resolveChildCapabilities(OPERATOR, 'managed', overrides, 'explicit'),
          (err) => err instanceof CapabilityEscalationError
        );
      });

      it('allows restricting child below parent', () => {
        const overrides = { exec: { mode: 'disabled' } };
        const child = resolveChildCapabilities(SOVEREIGN, 'operator', overrides, 'explicit');
        assert.strictEqual(child.exec.mode, 'disabled');
      });
    });

    // ── Edge Cases ──

    describe('edge cases', () => {

      it('throws on unknown child profile', () => {
        assert.throws(
          () => resolveChildCapabilities(SOVEREIGN, 'nonexistent'),
          /Unknown child profile/
        );
      });

      it('throws on unknown inheritance mode', () => {
        assert.throws(
          () => resolveChildCapabilities(SOVEREIGN, 'managed', {}, 'invalid'),
          /Unknown inheritance mode/
        );
      });

      it('defaults to inherit mode when not specified', () => {
        const child = resolveChildCapabilities(SOVEREIGN, 'sovereign');
        assert.strictEqual(child.exec.mode, 'unrestricted');
      });

      it('managed parent cannot spawn sovereign child (no escalation)', () => {
        // Even in profile-default mode, sovereign defaults exceed managed caps
        const child = resolveChildCapabilities(MANAGED, 'sovereign', {}, 'profile-default');
        // Should be clamped to managed levels
        assert.doesNotThrow(() => validateNoEscalation(MANAGED, child));
      });
    });
  });

  // ── CapabilityEscalationError ──

  describe('CapabilityEscalationError', () => {

    it('includes capability name and values', () => {
      const err = new CapabilityEscalationError('exec', { mode: 'disabled' }, { mode: 'unrestricted' });
      assert.strictEqual(err.name, 'CapabilityEscalationError');
      assert.strictEqual(err.capability, 'exec');
      assert.ok(err.message.includes('exec'));
      assert.ok(err.message.includes('escalation'));
    });
  });
});

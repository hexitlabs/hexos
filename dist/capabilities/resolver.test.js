/**
 * Tests for the profile resolver — loading, override merging, validation,
 * capability gate functions.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initCapabilities,
  getCapability,
  requireCapability,
  getResolvedProfile,
  getResolvedCapabilities,
  resetCapabilities,
  deepMerge,
} from './resolver.js';
import { CapabilityDeniedError } from './errors.js';
import { SOVEREIGN, OPERATOR, MANAGED } from './presets.js';

/** Silent logger to suppress output in tests */
const silentLogger = { info() {}, warn() {}, error() {} };

describe('Profile Resolver', () => {

  beforeEach(() => {
    resetCapabilities();
  });

  // ── Profile Loading ──

  it('loads sovereign profile with correct defaults', () => {
    const result = initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
    assert.strictEqual(result.profile, 'sovereign');
    assert.strictEqual(result.capabilities.exec.mode, 'unrestricted');
    assert.strictEqual(result.capabilities.selfUpdate, true);
  });

  it('loads operator profile', () => {
    const result = initCapabilities({ profile: 'operator' }, { logger: silentLogger });
    assert.strictEqual(result.profile, 'operator');
    assert.strictEqual(result.capabilities.exec.mode, 'allowlist');
    assert.strictEqual(result.capabilities.auditTrail, 'remote');
  });

  it('loads managed profile', () => {
    const result = initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    assert.strictEqual(result.profile, 'managed');
    assert.strictEqual(result.capabilities.exec.mode, 'disabled');
    assert.strictEqual(result.capabilities.agentSpawn, 'disabled');
  });

  it('throws on unknown profile name', () => {
    assert.throws(
      () => initCapabilities({ profile: 'custom' }, { logger: silentLogger }),
      /Invalid profile: "custom"/
    );
  });

  it('defaults to sovereign when no profile specified', () => {
    const result = initCapabilities({}, { logger: silentLogger });
    assert.strictEqual(result.profile, 'sovereign');
  });

  // ── Legacy Backward Compatibility ──

  it('maps legacy deploymentProfile "operator" to "sovereign"', () => {
    const warns = [];
    const logger = { info() {}, warn(m) { warns.push(m); }, error() {} };
    const result = initCapabilities({ deploymentProfile: 'operator' }, { logger });
    assert.strictEqual(result.profile, 'sovereign');
    assert.ok(warns.some(w => w.includes('Legacy deploymentProfile')));
  });

  it('maps legacy deploymentProfile "managed" to "managed"', () => {
    const result = initCapabilities({ deploymentProfile: 'managed' }, { logger: silentLogger });
    assert.strictEqual(result.profile, 'managed');
  });

  it('profile wins over deploymentProfile when both present', () => {
    const result = initCapabilities(
      { profile: 'operator', deploymentProfile: 'managed' },
      { logger: silentLogger }
    );
    assert.strictEqual(result.profile, 'operator');
  });

  // ── Override Merging ──

  it('applies simple override to preset', () => {
    const result = initCapabilities(
      { profile: 'sovereign', capabilities: { auditTrail: 'local' } },
      { logger: silentLogger }
    );
    assert.strictEqual(result.capabilities.auditTrail, 'local');
    // Other caps unchanged
    assert.strictEqual(result.capabilities.exec.mode, 'unrestricted');
  });

  it('deep-merges structured capability overrides', () => {
    const result = initCapabilities(
      {
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: 500 },
        },
      },
      { logger: silentLogger }
    );
    // monthlyDollars overridden
    assert.strictEqual(result.capabilities.costLimits.monthlyDollars, 500);
    // alertAtPercent preserved from preset
    assert.strictEqual(result.capabilities.costLimits.alertAtPercent, 80);
  });

  it('replaces array capabilities entirely', () => {
    const result = initCapabilities(
      {
        profile: 'sovereign',
        capabilities: {
          agentToolProfiles: ['minimal'],
        },
      },
      { logger: silentLogger }
    );
    assert.deepStrictEqual(result.capabilities.agentToolProfiles, ['minimal']);
  });

  // ── Frozen Capabilities ──

  it('freezes resolved capabilities', () => {
    const result = initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
    assert.ok(Object.isFrozen(result.capabilities));
    assert.throws(() => {
      result.capabilities.selfUpdate = false;
    });
  });

  it('deep-freezes nested objects', () => {
    const result = initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
    assert.ok(Object.isFrozen(result.capabilities.exec));
    assert.ok(Object.isFrozen(result.capabilities.costLimits));
    assert.throws(() => {
      result.capabilities.exec.mode = 'disabled';
    });
  });

  // ── Unknown Keys ──

  it('warns on unknown capability keys', () => {
    const result = initCapabilities(
      {
        profile: 'sovereign',
        capabilities: { tenantProvisioning: true },
      },
      { logger: silentLogger }
    );
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].includes('tenantProvisioning'));
  });

  it('does not include unknown keys in resolved capabilities', () => {
    const result = initCapabilities(
      {
        profile: 'sovereign',
        capabilities: { tenantProvisioning: true },
      },
      { logger: silentLogger }
    );
    assert.strictEqual('tenantProvisioning' in result.capabilities, false);
  });

  // ── Gate Functions ──

  describe('getCapability()', () => {
    it('returns capability value after init', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      assert.strictEqual(getCapability('selfUpdate'), true);
      assert.deepStrictEqual(getCapability('exec'), { mode: 'unrestricted' });
    });

    it('throws if not initialized', () => {
      assert.throws(
        () => getCapability('selfUpdate'),
        /not initialized/
      );
    });
  });

  describe('requireCapability()', () => {
    it('passes when capability matches required value', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      // Should not throw
      requireCapability('selfUpdate', true, 'test.action');
    });

    it('throws CapabilityDeniedError when value does not match', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      assert.throws(
        () => requireCapability('selfUpdate', true, 'self.update'),
        (err) => {
          assert.ok(err instanceof CapabilityDeniedError);
          assert.strictEqual(err.capability, 'selfUpdate');
          assert.strictEqual(err.action, 'self.update');
          return true;
        }
      );
    });

    it('passes for enum when current is at least as permissive as required', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      // unrestricted >= egress-controlled
      requireCapability('network', 'egress-controlled', 'test');
    });

    it('fails for enum when current is more restrictive than required', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      // egress-controlled < unrestricted
      assert.throws(
        () => requireCapability('network', 'unrestricted', 'test'),
        (err) => err instanceof CapabilityDeniedError
      );
    });

    it('throws if not initialized', () => {
      assert.throws(
        () => requireCapability('selfUpdate', true, 'test'),
        /not initialized/
      );
    });
  });

  // ── getResolvedProfile / getResolvedCapabilities ──

  it('getResolvedProfile returns profile name', () => {
    initCapabilities({ profile: 'operator' }, { logger: silentLogger });
    assert.strictEqual(getResolvedProfile(), 'operator');
  });

  it('getResolvedCapabilities returns frozen object', () => {
    initCapabilities({ profile: 'managed' }, { logger: silentLogger });
    const caps = getResolvedCapabilities();
    assert.ok(caps);
    assert.ok(Object.isFrozen(caps));
    assert.strictEqual(caps.agentSpawn, 'disabled');
  });

  // ── deepMerge ──

  describe('deepMerge()', () => {
    it('merges flat properties', () => {
      const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
      assert.deepStrictEqual(result, { a: 1, b: 3, c: 4 });
    });

    it('deep-merges nested objects', () => {
      const result = deepMerge(
        { x: { a: 1, b: 2 } },
        { x: { b: 3 } }
      );
      assert.deepStrictEqual(result, { x: { a: 1, b: 3 } });
    });

    it('replaces arrays entirely', () => {
      const result = deepMerge(
        { arr: [1, 2, 3] },
        { arr: [4, 5] }
      );
      assert.deepStrictEqual(result, { arr: [4, 5] });
    });

    it('does not mutate source objects', () => {
      const target = { a: { x: 1 } };
      const source = { a: { y: 2 } };
      deepMerge(target, source);
      assert.deepStrictEqual(target, { a: { x: 1 } });
      assert.deepStrictEqual(source, { a: { y: 2 } });
    });
  });
});

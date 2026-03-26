/**
 * Tests for profile presets — verifies all 3 presets match PRD §3.3 values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, PROFILE_NAMES, SOVEREIGN, OPERATOR, MANAGED } from './presets.js';
import { CAPABILITY_KEYS } from './types.js';

describe('Profile Presets', () => {

  it('exports all 3 profile names', () => {
    assert.deepStrictEqual(PROFILE_NAMES, ['sovereign', 'operator', 'managed']);
  });

  it('PROFILES record contains all 3 presets', () => {
    assert.ok(PROFILES.sovereign);
    assert.ok(PROFILES.operator);
    assert.ok(PROFILES.managed);
    assert.strictEqual(Object.keys(PROFILES).length, 3);
  });

  it('every preset has all 21 capability keys', () => {
    for (const [name, preset] of Object.entries(PROFILES)) {
      for (const key of CAPABILITY_KEYS) {
        assert.ok(
          key in preset,
          `Profile "${name}" is missing capability "${key}"`
        );
      }
      // No extra keys
      for (const key of Object.keys(preset)) {
        assert.ok(
          CAPABILITY_KEYS.includes(key),
          `Profile "${name}" has unexpected key "${key}"`
        );
      }
    }
  });

  describe('Sovereign preset', () => {
    it('has unrestricted exec', () => {
      assert.deepStrictEqual(SOVEREIGN.exec, { mode: 'unrestricted' });
    });

    it('has full browser access', () => {
      assert.deepStrictEqual(SOVEREIGN.browser, { mode: 'full' });
    });

    it('has full filesystem and network', () => {
      assert.strictEqual(SOVEREIGN.fileSystem, 'full');
      assert.strictEqual(SOVEREIGN.network, 'unrestricted');
    });

    it('enables all self-modification', () => {
      assert.strictEqual(SOVEREIGN.selfUpdate, true);
      assert.strictEqual(SOVEREIGN.skillInstall, 'any');
      assert.strictEqual(SOVEREIGN.configEdit, true);
      assert.strictEqual(SOVEREIGN.workspaceEdit, true);
      assert.strictEqual(SOVEREIGN.codeModification, true);
    });

    it('has unlimited agent spawning', () => {
      assert.strictEqual(SOVEREIGN.agentSpawn, 'unlimited');
      assert.strictEqual(SOVEREIGN.agentConcurrency, -1);
      assert.deepStrictEqual(SOVEREIGN.agentToolProfiles, ['full', 'coding', 'minimal']);
      assert.strictEqual(SOVEREIGN.agentCapabilityInheritance, 'inherit');
    });

    it('has no approval gates and disabled audit', () => {
      assert.deepStrictEqual(SOVEREIGN.approvalGates, { mode: 'none', bypassScheduled: true });
      assert.strictEqual(SOVEREIGN.auditTrail, 'disabled');
    });

    it('has unlimited cost limits', () => {
      assert.strictEqual(SOVEREIGN.costLimits.monthlyDollars, null);
      assert.strictEqual(SOVEREIGN.costLimits.perSessionDollars, null);
      assert.strictEqual(SOVEREIGN.costLimits.perTaskDollars, null);
      assert.strictEqual(SOVEREIGN.costLimits.alertAtPercent, 80);
    });

    it('has full infrastructure access', () => {
      assert.strictEqual(SOVEREIGN.channelBindings, true);
      assert.strictEqual(SOVEREIGN.cronScheduling, true);
      assert.strictEqual(SOVEREIGN.vaultAccess, 'full');
      assert.strictEqual(SOVEREIGN.httpServer, true);
      assert.strictEqual(SOVEREIGN.adminApi, true);
    });
  });

  describe('Operator preset', () => {
    it('has allowlist exec with default commands', () => {
      assert.strictEqual(OPERATOR.exec.mode, 'allowlist');
      assert.ok(OPERATOR.exec.allowlist.includes('git'));
      assert.ok(OPERATOR.exec.allowlist.includes('npm'));
      assert.ok(OPERATOR.exec.allowlist.includes('hexos'));
      assert.ok(OPERATOR.exec.allowlist.includes('curl'));
      assert.strictEqual(OPERATOR.exec.allowlist.length, 13);
    });

    it('has sandboxed browser', () => {
      assert.strictEqual(OPERATOR.browser.mode, 'sandboxed');
      assert.deepStrictEqual(OPERATOR.browser.navigationAllowlist, []);
      assert.strictEqual(OPERATOR.browser.blockDownloads, true);
      assert.strictEqual(OPERATOR.browser.blockExtensions, true);
    });

    it('has remote audit trail', () => {
      assert.strictEqual(OPERATOR.auditTrail, 'remote');
    });

    it('has cost limits set', () => {
      assert.strictEqual(OPERATOR.costLimits.monthlyDollars, 1000);
      assert.strictEqual(OPERATOR.costLimits.perSessionDollars, 50);
      assert.strictEqual(OPERATOR.costLimits.perTaskDollars, 10);
    });

    it('disables self-modification (except workspace)', () => {
      assert.strictEqual(OPERATOR.selfUpdate, false);
      assert.strictEqual(OPERATOR.configEdit, false);
      assert.strictEqual(OPERATOR.codeModification, false);
      assert.strictEqual(OPERATOR.workspaceEdit, true);
    });

    it('has budget-limited agent spawning with concurrency cap', () => {
      assert.strictEqual(OPERATOR.agentSpawn, 'budget-limited');
      assert.strictEqual(OPERATOR.agentConcurrency, 20);
    });
  });

  describe('Managed preset', () => {
    it('has disabled exec and browser', () => {
      assert.deepStrictEqual(MANAGED.exec, { mode: 'disabled' });
      assert.deepStrictEqual(MANAGED.browser, { mode: 'disabled' });
    });

    it('has all approval gates', () => {
      assert.strictEqual(MANAGED.approvalGates.mode, 'all');
    });

    it('has disabled agent spawning', () => {
      assert.strictEqual(MANAGED.agentSpawn, 'disabled');
      assert.strictEqual(MANAGED.agentConcurrency, 0);
    });

    it('has minimal infrastructure', () => {
      assert.strictEqual(MANAGED.channelBindings, false);
      assert.strictEqual(MANAGED.httpServer, false);
      assert.strictEqual(MANAGED.adminApi, false);
      assert.strictEqual(MANAGED.vaultAccess, 'injected-only');
    });

    it('has strict cost limits', () => {
      assert.strictEqual(MANAGED.costLimits.monthlyDollars, 100);
      assert.strictEqual(MANAGED.costLimits.perSessionDollars, 5);
      assert.strictEqual(MANAGED.costLimits.perTaskDollars, 2);
      assert.strictEqual(MANAGED.costLimits.alertAtPercent, 70);
    });

    it('has disabled external agent comms and skill install', () => {
      assert.strictEqual(MANAGED.externalAgentComms, 'disabled');
      assert.strictEqual(MANAGED.skillInstall, 'disabled');
    });
  });
});

/**
 * Tests for CapabilityDeniedError — formatting, fix hints, properties.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityDeniedError,
  CAPABILITY_FIX_HINTS,
  formatDenialMessage,
} from './errors.js';
import { CAPABILITY_KEYS } from './types.js';

describe('CapabilityDeniedError', () => {

  it('is an instance of Error', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CapabilityDeniedError);
  });

  it('has correct name property', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled');
    assert.strictEqual(err.name, 'CapabilityDeniedError');
  });

  it('exposes capability, action, and detail properties', () => {
    const err = new CapabilityDeniedError('browser', 'browser.launch', 'sandboxed', 'operator');
    assert.strictEqual(err.capability, 'browser');
    assert.strictEqual(err.action, 'browser.launch');
    assert.strictEqual(err.detail, 'sandboxed');
    assert.strictEqual(err.profile, 'operator');
  });

  it('includes action in message', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute(rm)', 'disabled');
    assert.ok(err.message.includes('shell.execute(rm)'));
  });

  it('includes capability and detail in message', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled');
    assert.ok(err.message.includes('exec'));
    assert.ok(err.message.includes('disabled'));
  });

  it('includes profile in message when provided', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled', 'managed');
    assert.ok(err.message.includes('managed'));
  });

  it('includes fix hint in message', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled');
    assert.ok(err.message.includes('allowlist'));
  });

  it('handles null profile gracefully', () => {
    const err = new CapabilityDeniedError('exec', 'shell.execute', 'disabled');
    assert.strictEqual(err.profile, null);
    assert.ok(!err.message.includes('Profile'));
  });
});

describe('CAPABILITY_FIX_HINTS', () => {

  it('has fix hints for all primary capabilities', () => {
    const expectedKeys = [
      'exec', 'browser', 'fileSystem', 'network',
      'selfUpdate', 'skillInstall', 'configEdit', 'workspaceEdit', 'codeModification',
      'agentSpawn', 'agentConcurrency', 'agentToolProfiles', 'agentCapabilityInheritance',
      'approvalGates', 'auditTrail', 'leakScanner', 'costLimits', 'externalAgentComms',
      'channelBindings', 'cronScheduling', 'vaultAccess', 'httpServer', 'adminApi',
    ];

    for (const key of expectedKeys) {
      assert.ok(
        key in CAPABILITY_FIX_HINTS,
        `Missing fix hint for capability "${key}"`
      );
      assert.ok(
        CAPABILITY_FIX_HINTS[key].length > 10,
        `Fix hint for "${key}" is too short`
      );
    }
  });

  it('covers all 21 capability keys', () => {
    for (const key of CAPABILITY_KEYS) {
      assert.ok(
        key in CAPABILITY_FIX_HINTS,
        `Missing fix hint for capability "${key}"`
      );
    }
  });
});

describe('formatDenialMessage()', () => {

  it('formats message with all parts', () => {
    const msg = formatDenialMessage('exec', 'shell.execute', 'disabled', 'managed');
    assert.ok(msg.includes('⛔ Action blocked: shell.execute'));
    assert.ok(msg.includes('Capability: exec = disabled'));
    assert.ok(msg.includes('Profile: managed'));
    assert.ok(msg.includes('Fix:'));
  });

  it('omits profile line when not provided', () => {
    const msg = formatDenialMessage('exec', 'shell.execute', 'disabled');
    assert.ok(!msg.includes('Profile:'));
  });

  it('includes fix hint for known capability', () => {
    const msg = formatDenialMessage('skillInstall', 'skill.install(tool)', 'disabled');
    assert.ok(msg.includes('vetted registry'));
  });
});

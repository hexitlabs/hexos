/**
 * Tests for the capability metrics system — counter increments,
 * label tracking, and reset.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  increment,
  recordCheck,
  recordApproval,
  getMetrics,
  getCounter,
  resetMetrics,
} from './metrics.js';

describe('Capability Metrics', () => {

  beforeEach(() => {
    resetMetrics();
  });

  // ── Basic Counter ──

  describe('increment()', () => {

    it('increments a counter with labels', () => {
      increment('test_counter', { action: 'test' });
      assert.strictEqual(getCounter('test_counter', { action: 'test' }), 1);
    });

    it('increments by custom amount', () => {
      increment('test_counter', { action: 'test' }, 5);
      assert.strictEqual(getCounter('test_counter', { action: 'test' }), 5);
    });

    it('tracks different label combinations separately', () => {
      increment('test_counter', { action: 'a' });
      increment('test_counter', { action: 'b' });
      increment('test_counter', { action: 'a' });

      assert.strictEqual(getCounter('test_counter', { action: 'a' }), 2);
      assert.strictEqual(getCounter('test_counter', { action: 'b' }), 1);
    });

    it('returns 0 for unknown counters', () => {
      assert.strictEqual(getCounter('nonexistent', {}), 0);
    });
  });

  // ── recordCheck ──

  describe('recordCheck()', () => {

    it('records allowed check', () => {
      recordCheck('exec', 'shell.execute', 'sovereign', 'allowed');

      assert.strictEqual(
        getCounter('hexos_capability_checks_total', {
          capability: 'exec', action: 'shell.execute', profile: 'sovereign', result: 'allowed',
        }),
        1
      );
    });

    it('records denied check and increments denied counter', () => {
      recordCheck('exec', 'shell.execute', 'managed', 'denied');

      assert.strictEqual(
        getCounter('hexos_capability_checks_total', {
          capability: 'exec', action: 'shell.execute', profile: 'managed', result: 'denied',
        }),
        1
      );
      assert.strictEqual(
        getCounter('hexos_capability_denied_total', {
          capability: 'exec', action: 'shell.execute', profile: 'managed',
        }),
        1
      );
    });

    it('does not increment denied counter for allowed checks', () => {
      recordCheck('exec', 'shell.execute', 'sovereign', 'allowed');
      assert.strictEqual(
        getCounter('hexos_capability_denied_total', {
          capability: 'exec', action: 'shell.execute', profile: 'sovereign',
        }),
        0
      );
    });
  });

  // ── recordApproval ──

  describe('recordApproval()', () => {

    it('records approval gate invocations', () => {
      recordApproval('message.send', 'external', 'approved');
      recordApproval('message.send', 'external', 'denied');
      recordApproval('file.delete', 'destructive', 'bypassed');

      assert.strictEqual(
        getCounter('hexos_approval_gates_total', {
          action: 'message.send', category: 'external', result: 'approved',
        }),
        1
      );
      assert.strictEqual(
        getCounter('hexos_approval_gates_total', {
          action: 'file.delete', category: 'destructive', result: 'bypassed',
        }),
        1
      );
    });
  });

  // ── getMetrics ──

  describe('getMetrics()', () => {

    it('returns all counters with labels', () => {
      recordCheck('exec', 'shell.execute', 'sovereign', 'allowed');
      recordCheck('browser', 'browser.launch', 'operator', 'denied');

      const metrics = getMetrics();
      assert.ok('hexos_capability_checks_total' in metrics);

      const checks = metrics['hexos_capability_checks_total'];
      assert.strictEqual(checks.length, 2);
    });

    it('returns empty object when no metrics recorded', () => {
      const metrics = getMetrics();
      assert.deepStrictEqual(metrics, {});
    });
  });

  // ── resetMetrics ──

  describe('resetMetrics()', () => {

    it('clears all counters', () => {
      recordCheck('exec', 'test', 'sovereign', 'allowed');
      recordApproval('test', 'internal', 'approved');
      assert.ok(Object.keys(getMetrics()).length > 0);

      resetMetrics();
      assert.deepStrictEqual(getMetrics(), {});
    });
  });
});

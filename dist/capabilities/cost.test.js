/**
 * Tests for the cost limit enforcement system — InMemory provider,
 * limit checking, alerts, and hard blocking.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryCostProvider,
  CostLimitExceededError,
  trackLLMCost,
  getCostProvider,
  setCostProvider,
  drainAlerts,
} from './cost.js';
import { initCapabilities, resetCapabilities } from './resolver.js';

const silentLogger = { info() {}, warn() {}, error() {} };

/** Helper to create a usage event */
function makeUsage(overrides = {}) {
  return {
    model: 'claude-opus-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    costDollars: 0.05,
    purpose: 'test',
    sessionId: 'session-1',
    taskId: 'task-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Cost Limit Enforcement', () => {

  beforeEach(() => {
    resetCapabilities();
    // Reset the global provider
    setCostProvider(new InMemoryCostProvider());
    drainAlerts();
  });

  // ── InMemoryCostProvider ──

  describe('InMemoryCostProvider', () => {

    it('starts with zero spend', () => {
      const provider = new InMemoryCostProvider();
      assert.strictEqual(provider.getMonthlySpend(), 0);
      assert.strictEqual(provider.getSessionSpend('any'), 0);
      assert.strictEqual(provider.getTaskSpend('any'), 0);
    });

    it('records usage and increments monthly total', () => {
      const provider = new InMemoryCostProvider();
      provider.recordUsage(makeUsage({ costDollars: 1.50 }));
      assert.strictEqual(provider.getMonthlySpend(), 1.50);
    });

    it('tracks per-session spend', () => {
      const provider = new InMemoryCostProvider();
      provider.recordUsage(makeUsage({ sessionId: 'sess-a', costDollars: 2.00 }));
      provider.recordUsage(makeUsage({ sessionId: 'sess-b', costDollars: 3.00 }));
      provider.recordUsage(makeUsage({ sessionId: 'sess-a', costDollars: 1.00 }));

      assert.strictEqual(provider.getSessionSpend('sess-a'), 3.00);
      assert.strictEqual(provider.getSessionSpend('sess-b'), 3.00);
    });

    it('tracks per-task spend', () => {
      const provider = new InMemoryCostProvider();
      provider.recordUsage(makeUsage({ taskId: 'task-x', costDollars: 0.50 }));
      provider.recordUsage(makeUsage({ taskId: 'task-y', costDollars: 1.00 }));
      provider.recordUsage(makeUsage({ taskId: 'task-x', costDollars: 0.25 }));

      assert.strictEqual(provider.getTaskSpend('task-x'), 0.75);
      assert.strictEqual(provider.getTaskSpend('task-y'), 1.00);
    });

    it('accumulates monthly total across sessions and tasks', () => {
      const provider = new InMemoryCostProvider();
      provider.recordUsage(makeUsage({ sessionId: 's1', taskId: 't1', costDollars: 1.00 }));
      provider.recordUsage(makeUsage({ sessionId: 's2', taskId: 't2', costDollars: 2.00 }));
      assert.strictEqual(provider.getMonthlySpend(), 3.00);
    });

    it('stores all events', () => {
      const provider = new InMemoryCostProvider();
      const e1 = makeUsage({ costDollars: 1.00 });
      const e2 = makeUsage({ costDollars: 2.00 });
      provider.recordUsage(e1);
      provider.recordUsage(e2);

      const events = provider.getEvents();
      assert.strictEqual(events.length, 2);
    });

    it('resets all counters', () => {
      const provider = new InMemoryCostProvider();
      provider.recordUsage(makeUsage({ costDollars: 5.00, sessionId: 's1', taskId: 't1' }));
      provider.reset();

      assert.strictEqual(provider.getMonthlySpend(), 0);
      assert.strictEqual(provider.getSessionSpend('s1'), 0);
      assert.strictEqual(provider.getTaskSpend('t1'), 0);
      assert.strictEqual(provider.getEvents().length, 0);
    });
  });

  // ── Provider Management ──

  describe('getCostProvider / setCostProvider', () => {

    it('returns default InMemory provider', () => {
      const provider = getCostProvider();
      assert.ok(provider instanceof InMemoryCostProvider);
    });

    it('allows setting a custom provider', () => {
      const custom = new InMemoryCostProvider();
      setCostProvider(custom);
      assert.strictEqual(getCostProvider(), custom);
    });

    it('rejects invalid provider', () => {
      assert.throws(
        () => setCostProvider({}),
        /recordUsage/
      );
    });
  });

  // ── trackLLMCost ──

  describe('trackLLMCost()', () => {

    it('records usage when no limits are set (sovereign)', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      trackLLMCost(makeUsage({ costDollars: 10.00 }));

      assert.strictEqual(getCostProvider().getMonthlySpend(), 10.00);
    });

    it('blocks when monthly limit exceeded', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: 100, perSessionDollars: null, perTaskDollars: null, alertAtPercent: 80 },
        },
      }, { logger: silentLogger });

      // Spend close to limit (each call uses unique session/task)
      trackLLMCost(makeUsage({ costDollars: 99.00, sessionId: 'monthly-s1', taskId: 'monthly-t1' }));

      // This should push over and throw
      assert.throws(
        () => trackLLMCost(makeUsage({ costDollars: 5.00, sessionId: 'monthly-s2', taskId: 'monthly-t2' })),
        (err) => {
          assert.ok(err instanceof CostLimitExceededError);
          assert.strictEqual(err.period, 'monthly');
          return true;
        }
      );
    });

    it('blocks when session limit exceeded', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: null, perSessionDollars: 5, perTaskDollars: null, alertAtPercent: 80 },
        },
      }, { logger: silentLogger });

      trackLLMCost(makeUsage({ sessionId: 'sess-1', taskId: 'sess-t1', costDollars: 4.00 }));
      assert.throws(
        () => trackLLMCost(makeUsage({ sessionId: 'sess-1', taskId: 'sess-t2', costDollars: 3.00 })),
        (err) => {
          assert.ok(err instanceof CostLimitExceededError);
          assert.strictEqual(err.period, 'session');
          return true;
        }
      );
    });

    it('blocks when task limit exceeded', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: null, perSessionDollars: null, perTaskDollars: 2, alertAtPercent: 80 },
        },
      }, { logger: silentLogger });

      trackLLMCost(makeUsage({ taskId: 'task-1', sessionId: 'task-s1', costDollars: 1.50 }));
      assert.throws(
        () => trackLLMCost(makeUsage({ taskId: 'task-1', sessionId: 'task-s1', costDollars: 1.00 })),
        (err) => {
          assert.ok(err instanceof CostLimitExceededError);
          assert.strictEqual(err.period, 'task');
          return true;
        }
      );
    });

    it('emits alert when threshold is crossed', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: 100, perSessionDollars: null, perTaskDollars: null, alertAtPercent: 80 },
        },
      }, { logger: silentLogger });

      // Spend up to threshold (unique sessions/tasks to avoid sub-limits)
      trackLLMCost(makeUsage({ costDollars: 79.00, sessionId: 'alert-s1', taskId: 'alert-t1' }));
      let alerts = drainAlerts();
      assert.strictEqual(alerts.length, 0);

      // Cross threshold
      trackLLMCost(makeUsage({ costDollars: 5.00, sessionId: 'alert-s2', taskId: 'alert-t2' }));
      alerts = drainAlerts();
      assert.strictEqual(alerts.length, 1);
      assert.strictEqual(alerts[0].period, 'monthly');
      assert.strictEqual(alerts[0].percent, 80);
    });

    it('does not emit duplicate alerts', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          costLimits: { monthlyDollars: 100, perSessionDollars: null, perTaskDollars: null, alertAtPercent: 80 },
        },
      }, { logger: silentLogger });

      trackLLMCost(makeUsage({ costDollars: 81.00, sessionId: 'dup-s1', taskId: 'dup-t1' }));
      drainAlerts(); // First alert

      // Additional spend above threshold should not re-alert
      trackLLMCost(makeUsage({ costDollars: 5.00, sessionId: 'dup-s2', taskId: 'dup-t2' }));
      const alerts = drainAlerts();
      assert.strictEqual(alerts.length, 0);
    });

    it('allows spend within limits', () => {
      initCapabilities({ profile: 'operator' }, { logger: silentLogger });
      // Operator has monthlyDollars: 1000

      // Well within limit — should not throw
      trackLLMCost(makeUsage({ costDollars: 10.00 }));
      assert.strictEqual(getCostProvider().getMonthlySpend(), 10.00);
    });
  });

  // ── CostLimitExceededError ──

  describe('CostLimitExceededError', () => {

    it('has correct properties', () => {
      const err = new CostLimitExceededError('monthly', 105.50, 100);
      assert.strictEqual(err.name, 'CostLimitExceededError');
      assert.strictEqual(err.period, 'monthly');
      assert.strictEqual(err.current, 105.50);
      assert.strictEqual(err.limit, 100);
      assert.ok(err.message.includes('105.50'));
      assert.ok(err.message.includes('100.00'));
    });
  });
});

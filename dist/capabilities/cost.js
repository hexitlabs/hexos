/**
 * HexOS Cost Limit Enforcement — Phase 2 (v0.8.0)
 *
 * Pluggable cost provider system with in-memory tracking and
 * hard limit enforcement per monthly/session/task budgets.
 *
 * See PRD §5.2 for specification.
 */

import { getCapability } from './resolver.js';

/**
 * @typedef {Object} LLMUsageEvent
 * @property {string} model - Model identifier (e.g. 'claude-opus-4-20250514')
 * @property {number} inputTokens - Input token count
 * @property {number} outputTokens - Output token count
 * @property {number} costDollars - Cost in USD
 * @property {string} purpose - What the call was for
 * @property {string} sessionId - Session identifier
 * @property {string} taskId - Task identifier
 * @property {number} timestamp - Unix timestamp (ms)
 */

/**
 * @typedef {Object} CostAlert
 * @property {'monthly' | 'session' | 'task'} period
 * @property {number} current - Current spend in dollars
 * @property {number} limit - Limit in dollars
 * @property {number} percent - Alert threshold that was crossed
 */

/**
 * Alert events emitted when cost thresholds are reached.
 * @type {CostAlert[]}
 */
const alertLog = [];

/**
 * Get and clear accumulated alerts (for testing and integration).
 * @returns {CostAlert[]}
 */
export function drainAlerts() {
  return alertLog.splice(0);
}

/**
 * @interface CostProvider
 *
 * Interface for cost data sources. v0.8.0 ships with InMemoryCostProvider.
 * v0.9.0 will add DatabaseCostProvider (PostgreSQL/Neon, billing-grade).
 */

/**
 * In-memory cost provider — tracks costs per-process, resets on restart.
 * Suitable for single-instance, non-billing-critical deployments.
 */
export class InMemoryCostProvider {
  constructor() {
    /** @type {LLMUsageEvent[]} */
    this._events = [];
    /** @type {number} */
    this._monthlyTotal = 0;
    /** @type {Map<string, number>} */
    this._sessionTotals = new Map();
    /** @type {Map<string, number>} */
    this._taskTotals = new Map();
  }

  /**
   * Get total monthly spend (current month, current process).
   * @returns {number}
   */
  getMonthlySpend() {
    return this._monthlyTotal;
  }

  /**
   * Get spend for a specific session.
   * @param {string} sessionId
   * @returns {number}
   */
  getSessionSpend(sessionId) {
    return this._sessionTotals.get(sessionId) || 0;
  }

  /**
   * Get spend for a specific task.
   * @param {string} taskId
   * @returns {number}
   */
  getTaskSpend(taskId) {
    return this._taskTotals.get(taskId) || 0;
  }

  /**
   * Record a usage event. Atomically increments all counters.
   * @param {LLMUsageEvent} event
   */
  recordUsage(event) {
    this._events.push(event);

    // Atomic increments
    this._monthlyTotal += event.costDollars;

    const sessionCurrent = this._sessionTotals.get(event.sessionId) || 0;
    this._sessionTotals.set(event.sessionId, sessionCurrent + event.costDollars);

    const taskCurrent = this._taskTotals.get(event.taskId) || 0;
    this._taskTotals.set(event.taskId, taskCurrent + event.costDollars);
  }

  /**
   * Get all recorded events (for debugging/testing).
   * @returns {LLMUsageEvent[]}
   */
  getEvents() {
    return [...this._events];
  }

  /**
   * Reset all counters (for testing).
   */
  reset() {
    this._events = [];
    this._monthlyTotal = 0;
    this._sessionTotals.clear();
    this._taskTotals.clear();
  }
}

// ── Pluggable Provider ─────────────────────────────────────────

/** @type {InMemoryCostProvider} */
let currentProvider = new InMemoryCostProvider();

/**
 * Get the current cost provider.
 * @returns {InMemoryCostProvider}
 */
export function getCostProvider() {
  return currentProvider;
}

/**
 * Set a custom cost provider (e.g. DatabaseCostProvider in v0.9.0).
 * @param {InMemoryCostProvider} provider
 */
export function setCostProvider(provider) {
  if (!provider || typeof provider.recordUsage !== 'function') {
    throw new Error('Cost provider must implement recordUsage()');
  }
  currentProvider = provider;
}

// ── Cost Limit Error ───────────────────────────────────────────

/**
 * Error thrown when a cost limit is exceeded.
 */
export class CostLimitExceededError extends Error {
  /**
   * @param {'monthly' | 'session' | 'task'} period
   * @param {number} current - Current spend
   * @param {number} limit - The limit that was exceeded
   */
  constructor(period, current, limit) {
    const message = [
      `💰 Cost limit exceeded: ${period}`,
      `   Current: $${current.toFixed(2)}`,
      `   Limit: $${limit.toFixed(2)}`,
      `   Increase costLimits.${period === 'monthly' ? 'monthlyDollars' : period === 'session' ? 'perSessionDollars' : 'perTaskDollars'} in capabilities, or wait for ${period === 'monthly' ? 'monthly reset' : 'new ' + period}.`,
    ].join('\n');
    super(message);
    this.name = 'CostLimitExceededError';
    this.period = period;
    this.current = current;
    this.limit = limit;
  }
}

// ── Track LLM Cost ─────────────────────────────────────────────

/**
 * Track an LLM usage event against cost limits.
 *
 * 1. Records the usage via the cost provider
 * 2. Checks monthly/session/task limits
 * 3. Emits alerts at threshold percentages
 * 4. Throws CostLimitExceededError if hard limit is exceeded
 *
 * @param {LLMUsageEvent} usage
 * @throws {CostLimitExceededError}
 */
export function trackLLMCost(usage) {
  const provider = getCostProvider();

  // Always record usage first
  provider.recordUsage(usage);

  // Get cost limits capability
  const limits = getCapability('costLimits');

  // If no limits configured (all null) → just record and return
  if (!limits) return;

  // Check monthly limit
  if (limits.monthlyDollars !== null) {
    const monthlySpend = provider.getMonthlySpend();
    const threshold = limits.monthlyDollars * (limits.alertAtPercent / 100);

    // Alert at threshold
    if (monthlySpend >= threshold && (monthlySpend - usage.costDollars) < threshold) {
      alertLog.push({
        period: 'monthly',
        current: monthlySpend,
        limit: limits.monthlyDollars,
        percent: limits.alertAtPercent,
      });
    }

    // Hard limit
    if (monthlySpend > limits.monthlyDollars) {
      throw new CostLimitExceededError('monthly', monthlySpend, limits.monthlyDollars);
    }
  }

  // Check session limit
  if (limits.perSessionDollars !== null) {
    const sessionSpend = provider.getSessionSpend(usage.sessionId);
    const threshold = limits.perSessionDollars * (limits.alertAtPercent / 100);

    if (sessionSpend >= threshold && (sessionSpend - usage.costDollars) < threshold) {
      alertLog.push({
        period: 'session',
        current: sessionSpend,
        limit: limits.perSessionDollars,
        percent: limits.alertAtPercent,
      });
    }

    if (sessionSpend > limits.perSessionDollars) {
      throw new CostLimitExceededError('session', sessionSpend, limits.perSessionDollars);
    }
  }

  // Check task limit
  if (limits.perTaskDollars !== null) {
    const taskSpend = provider.getTaskSpend(usage.taskId);
    const threshold = limits.perTaskDollars * (limits.alertAtPercent / 100);

    if (taskSpend >= threshold && (taskSpend - usage.costDollars) < threshold) {
      alertLog.push({
        period: 'task',
        current: taskSpend,
        limit: limits.perTaskDollars,
        percent: limits.alertAtPercent,
      });
    }

    if (taskSpend > limits.perTaskDollars) {
      throw new CostLimitExceededError('task', taskSpend, limits.perTaskDollars);
    }
  }
}

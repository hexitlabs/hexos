/**
 * HexOS Capability Metrics — Phase 2 (v0.8.0)
 *
 * Simple counter-based metrics for capability checks, denials, and approvals.
 * No external dependencies (prom-client etc.) — just plain counters
 * structured for future Prometheus endpoint exposure.
 *
 * See PRD §7 for specification.
 */

/**
 * @typedef {Object} MetricLabels
 * @property {string} [capability] - Capability key
 * @property {string} [action] - Action being attempted
 * @property {string} [profile] - Active profile name
 * @property {string} [result] - Result of check (allowed/denied)
 * @property {string} [category] - Action category (for approvals)
 */

/**
 * Internal counter state.
 * Keyed by metric name → label combo string → count.
 * @type {Map<string, Map<string, number>>}
 */
const counters = new Map();

/**
 * Serialize labels to a stable key string for counter lookup.
 * @param {MetricLabels} labels
 * @returns {string}
 */
function labelKey(labels) {
  const entries = Object.entries(labels || {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join(',');
}

/**
 * Increment a counter.
 * @param {string} name - Metric name
 * @param {MetricLabels} [labels] - Label set
 * @param {number} [amount=1] - Amount to increment
 */
export function increment(name, labels = {}, amount = 1) {
  if (!counters.has(name)) {
    counters.set(name, new Map());
  }
  const key = labelKey(labels);
  const counter = counters.get(name);
  counter.set(key, (counter.get(key) || 0) + amount);
}

/**
 * Record a capability check (called from requireCapability).
 * @param {string} capability - Capability key
 * @param {string} action - Action attempted
 * @param {string} profile - Active profile
 * @param {'allowed' | 'denied'} result - Check result
 */
export function recordCheck(capability, action, profile, result) {
  increment('hexos_capability_checks_total', { capability, action, profile, result });

  if (result === 'denied') {
    increment('hexos_capability_denied_total', { capability, action, profile });
  }
}

/**
 * Record an approval gate invocation.
 * @param {string} action - Action attempted
 * @param {string} category - Action category (internal/external/destructive)
 * @param {'approved' | 'denied' | 'bypassed'} result - Gate result
 */
export function recordApproval(action, category, result) {
  increment('hexos_approval_gates_total', { action, category, result });
}

/**
 * Get the current metrics state.
 * Returns a plain object of all counters with their label sets.
 *
 * @returns {Object<string, Array<{ labels: MetricLabels, value: number }>>}
 */
export function getMetrics() {
  const result = {};

  for (const [name, labelMap] of counters) {
    const entries = [];
    for (const [key, value] of labelMap) {
      // Parse label key back to object
      const labels = {};
      if (key) {
        for (const part of key.split(',')) {
          const [k, v] = part.split('=');
          labels[k] = v;
        }
      }
      entries.push({ labels, value });
    }
    result[name] = entries;
  }

  return result;
}

/**
 * Get a specific counter value.
 * @param {string} name - Metric name
 * @param {MetricLabels} [labels] - Label set
 * @returns {number}
 */
export function getCounter(name, labels = {}) {
  const counter = counters.get(name);
  if (!counter) return 0;
  return counter.get(labelKey(labels)) || 0;
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics() {
  counters.clear();
}

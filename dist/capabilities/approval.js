/**
 * HexOS Approval Gate System — Phase 2 (v0.8.0)
 *
 * Action categorization and approval flow for the capability gate system.
 * Actions are categorized as 'internal', 'external', or 'destructive',
 * and checked against the approvalGates capability before execution.
 *
 * See PRD §5.3 for specification.
 */

import { getCapability } from './resolver.js';

/**
 * @typedef {'internal' | 'external' | 'destructive'} ActionCategory
 */

/**
 * @typedef {Object} ActionContext
 * @property {boolean} scheduled - Whether this action was triggered by a scheduled task
 * @property {string} [cronJobId] - ID of the cron job (if scheduled)
 * @property {string} sessionId - Current session ID
 */

/** Actions that communicate externally */
export const EXTERNAL_ACTIONS = [
  'message.send',
  'email.send',
  'tweet.post',
  'webhook.call',
  'api.external',
  'file.upload.external',
];

/** Actions that destroy or irreversibly modify resources */
export const DESTRUCTIVE_ACTIONS = [
  'file.delete',
  'container.destroy',
  'vault.remove',
  'config.overwrite',
  'database.drop',
];

/**
 * Categorize an action as internal, external, or destructive.
 *
 * @param {string} action - The action identifier (e.g. 'message.send')
 * @returns {ActionCategory}
 */
export function categorizeAction(action) {
  if (DESTRUCTIVE_ACTIONS.includes(action)) return 'destructive';
  if (EXTERNAL_ACTIONS.includes(action)) return 'external';
  return 'internal';
}

/**
 * @typedef {Object} ApprovalResult
 * @property {boolean} approved - Whether the action is approved to proceed
 * @property {'allowed' | 'bypassed' | 'blocked'} reason - Why it was approved or blocked
 * @property {string} [auditEvent] - Audit event type if one should be emitted
 */

/**
 * Audit events emitted during approval checks.
 * Consumers can subscribe to these for logging.
 *
 * @type {Array<{ type: string, data: object }>}
 */
const auditLog = [];

/**
 * Get and clear accumulated audit events (for testing and integration).
 * @returns {Array<{ type: string, data: object }>}
 */
export function drainAuditEvents() {
  return auditLog.splice(0);
}

/**
 * Check whether an action requires approval and whether it is currently allowed.
 *
 * @param {string} action - The action being attempted
 * @param {ActionContext} context - Execution context
 * @returns {ApprovalResult}
 * @throws {ApprovalRequiredError} If the action needs approval and cannot proceed
 */
export function checkApproval(action, context) {
  const gates = getCapability('approvalGates');

  // Mode 'none' — no approval required for anything
  if (gates.mode === 'none') {
    return { approved: true, reason: 'allowed' };
  }

  // Scheduled task bypass — operator-configured crons run without approval
  if (gates.bypassScheduled && context.scheduled) {
    auditLog.push({
      type: 'approval.bypassed.scheduled',
      data: { action, cronJobId: context.cronJobId, sessionId: context.sessionId },
    });
    return { approved: true, reason: 'bypassed' };
  }

  const category = categorizeAction(action);

  // Determine if this action category requires approval under the current mode
  const needsApproval =
    gates.mode === 'all' ||
    (gates.mode === 'external-only' && category === 'external') ||
    (gates.mode === 'destructive' && (category === 'destructive' || category === 'external'));

  if (needsApproval) {
    throw new ApprovalRequiredError(action, category, gates.mode);
  }

  return { approved: true, reason: 'allowed' };
}

/**
 * Error thrown when an action requires approval before it can proceed.
 */
export class ApprovalRequiredError extends Error {
  /**
   * @param {string} action - The action that requires approval
   * @param {ActionCategory} category - Action category
   * @param {string} gateMode - The active approval gate mode
   */
  constructor(action, category, gateMode) {
    const message = [
      `🔒 Approval required: ${action}`,
      `   Category: ${category}`,
      `   Gate mode: ${gateMode}`,
      `   Submit this action for operator/human approval to proceed.`,
    ].join('\n');
    super(message);
    this.name = 'ApprovalRequiredError';
    this.action = action;
    this.category = category;
    this.gateMode = gateMode;
  }
}

/**
 * Tests for the approval gate system — action categorization,
 * approval flow, scheduled bypass, and gate modes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorizeAction,
  checkApproval,
  ApprovalRequiredError,
  EXTERNAL_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  drainAuditEvents,
} from './approval.js';
import { initCapabilities, resetCapabilities } from './resolver.js';

const silentLogger = { info() {}, warn() {}, error() {} };

describe('Approval Gate System', () => {

  beforeEach(() => {
    resetCapabilities();
    drainAuditEvents(); // Clear any accumulated audit events
  });

  // ── Action Categorization ──

  describe('categorizeAction()', () => {

    it('categorizes external actions correctly', () => {
      for (const action of EXTERNAL_ACTIONS) {
        assert.strictEqual(categorizeAction(action), 'external', `Expected ${action} to be external`);
      }
    });

    it('categorizes destructive actions correctly', () => {
      for (const action of DESTRUCTIVE_ACTIONS) {
        assert.strictEqual(categorizeAction(action), 'destructive', `Expected ${action} to be destructive`);
      }
    });

    it('categorizes unknown actions as internal', () => {
      assert.strictEqual(categorizeAction('file.read'), 'internal');
      assert.strictEqual(categorizeAction('shell.execute'), 'internal');
      assert.strictEqual(categorizeAction('agent.spawn'), 'internal');
      assert.strictEqual(categorizeAction('some.random.action'), 'internal');
    });

    it('has expected external actions', () => {
      assert.ok(EXTERNAL_ACTIONS.includes('message.send'));
      assert.ok(EXTERNAL_ACTIONS.includes('email.send'));
      assert.ok(EXTERNAL_ACTIONS.includes('tweet.post'));
      assert.ok(EXTERNAL_ACTIONS.includes('webhook.call'));
      assert.ok(EXTERNAL_ACTIONS.includes('api.external'));
      assert.ok(EXTERNAL_ACTIONS.includes('file.upload.external'));
      assert.strictEqual(EXTERNAL_ACTIONS.length, 6);
    });

    it('has expected destructive actions', () => {
      assert.ok(DESTRUCTIVE_ACTIONS.includes('file.delete'));
      assert.ok(DESTRUCTIVE_ACTIONS.includes('container.destroy'));
      assert.ok(DESTRUCTIVE_ACTIONS.includes('vault.remove'));
      assert.ok(DESTRUCTIVE_ACTIONS.includes('config.overwrite'));
      assert.ok(DESTRUCTIVE_ACTIONS.includes('database.drop'));
      assert.strictEqual(DESTRUCTIVE_ACTIONS.length, 5);
    });
  });

  // ── Gate Mode: none ──

  describe('mode: none (sovereign default)', () => {

    it('allows all actions without approval', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      const result = checkApproval('message.send', ctx);
      assert.strictEqual(result.approved, true);
      assert.strictEqual(result.reason, 'allowed');
    });

    it('allows destructive actions without approval', () => {
      initCapabilities({ profile: 'sovereign' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      const result = checkApproval('file.delete', ctx);
      assert.strictEqual(result.approved, true);
    });
  });

  // ── Gate Mode: external-only ──

  describe('mode: external-only (operator default)', () => {

    it('blocks external actions', () => {
      initCapabilities({ profile: 'operator' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      assert.throws(
        () => checkApproval('message.send', ctx),
        (err) => {
          assert.ok(err instanceof ApprovalRequiredError);
          assert.strictEqual(err.category, 'external');
          assert.strictEqual(err.gateMode, 'external-only');
          return true;
        }
      );
    });

    it('allows internal actions', () => {
      initCapabilities({ profile: 'operator' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      const result = checkApproval('file.read', ctx);
      assert.strictEqual(result.approved, true);
    });

    it('allows destructive actions (not gated in external-only mode)', () => {
      initCapabilities({ profile: 'operator' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      const result = checkApproval('file.delete', ctx);
      assert.strictEqual(result.approved, true);
    });
  });

  // ── Gate Mode: all ──

  describe('mode: all (managed default)', () => {

    it('blocks external actions', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      assert.throws(
        () => checkApproval('email.send', ctx),
        (err) => err instanceof ApprovalRequiredError
      );
    });

    it('blocks destructive actions', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      assert.throws(
        () => checkApproval('container.destroy', ctx),
        (err) => err instanceof ApprovalRequiredError
      );
    });

    it('blocks internal actions too', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      assert.throws(
        () => checkApproval('file.read', ctx),
        (err) => err instanceof ApprovalRequiredError
      );
    });
  });

  // ── Scheduled Bypass ──

  describe('bypassScheduled', () => {

    it('bypasses approval for scheduled tasks when enabled', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: true, cronJobId: 'cron-123', sessionId: 'test-session' };

      const result = checkApproval('email.send', ctx);
      assert.strictEqual(result.approved, true);
      assert.strictEqual(result.reason, 'bypassed');
    });

    it('emits audit event on scheduled bypass', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: true, cronJobId: 'cron-456', sessionId: 'test-session' };

      checkApproval('message.send', ctx);
      const events = drainAuditEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'approval.bypassed.scheduled');
      assert.strictEqual(events[0].data.cronJobId, 'cron-456');
    });

    it('does not bypass when context.scheduled is false', () => {
      initCapabilities({ profile: 'managed' }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      assert.throws(
        () => checkApproval('message.send', ctx),
        (err) => err instanceof ApprovalRequiredError
      );
    });
  });

  // ── Gate Mode: destructive ──

  describe('mode: destructive (custom override)', () => {

    it('blocks destructive and external but allows internal', () => {
      initCapabilities({
        profile: 'sovereign',
        capabilities: {
          approvalGates: { mode: 'destructive' },
        },
      }, { logger: silentLogger });
      const ctx = { scheduled: false, sessionId: 'test-session' };

      // Internal — allowed
      const result = checkApproval('file.read', ctx);
      assert.strictEqual(result.approved, true);

      // External — blocked (destructive mode gates external too)
      assert.throws(
        () => checkApproval('email.send', ctx),
        (err) => err instanceof ApprovalRequiredError
      );

      // Destructive — blocked
      assert.throws(
        () => checkApproval('database.drop', ctx),
        (err) => err instanceof ApprovalRequiredError
      );
    });
  });

  // ── ApprovalRequiredError ──

  describe('ApprovalRequiredError', () => {

    it('includes action, category, and gate mode', () => {
      const err = new ApprovalRequiredError('message.send', 'external', 'external-only');
      assert.strictEqual(err.name, 'ApprovalRequiredError');
      assert.strictEqual(err.action, 'message.send');
      assert.strictEqual(err.category, 'external');
      assert.strictEqual(err.gateMode, 'external-only');
      assert.ok(err.message.includes('message.send'));
      assert.ok(err.message.includes('external'));
    });
  });
});

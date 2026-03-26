/**
 * Tests for vault leak detection engine.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { shannonEntropy } from "./leak-scanner.js";

describe("vault/leak-scanner", () => {
  describe("shannonEntropy", () => {
    it("returns 0 for empty string", () => {
      assert.equal(shannonEntropy(""), 0);
    });

    it("returns 0 for single repeated character", () => {
      assert.equal(shannonEntropy("aaaaaaaaaa"), 0);
    });

    it("returns low entropy for simple strings", () => {
      const entropy = shannonEntropy("hello");
      assert.ok(entropy > 0);
      assert.ok(entropy < 3);
    });

    it("returns high entropy for random-looking strings", () => {
      // High entropy string (looks like an API key)
      const entropy = shannonEntropy(
        "sk-ant-api03-Xb9K2mQ7nR4pL8sT1wV5yZ0aC3dE6fG8hJ-kMnOpQrStUvWxYz"
      );
      assert.ok(entropy > 4, `Expected entropy > 4, got ${entropy}`);
    });

    it("returns high entropy for actual API key format", () => {
      const entropy = shannonEntropy("BSAjf8sd9f8JKsdf98jsdf98jsd9f8j");
      assert.ok(entropy > 3.0, `Expected entropy > 3.0, got ${entropy}`);
    });
  });
});

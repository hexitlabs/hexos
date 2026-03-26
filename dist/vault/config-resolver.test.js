/**
 * Tests for vault config resolver.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasVaultRefs, collectVaultRefs } from "./config-resolver.js";

describe("vault/config-resolver", () => {
  describe("hasVaultRefs", () => {
    it("returns false for config without vault refs", () => {
      const cfg = {
        models: {
          providers: {
            anthropic: { apiKey: "sk-ant-real-key" },
          },
        },
      };
      assert.equal(hasVaultRefs(cfg), false);
    });

    it("returns true for config with vault refs", () => {
      const cfg = {
        models: {
          providers: {
            anthropic: { apiKey: "$vault:ANTHROPIC_KEY" },
          },
        },
      };
      assert.equal(hasVaultRefs(cfg), true);
    });

    it("returns true for nested vault refs", () => {
      const cfg = {
        channels: {
          telegram: {
            botToken: "$vault:TELEGRAM_BOT_TOKEN",
          },
        },
        tools: {
          web: { search: { apiKey: "not-a-ref" } },
        },
      };
      assert.equal(hasVaultRefs(cfg), true);
    });

    it("handles arrays with vault refs", () => {
      const cfg = {
        items: ["$vault:KEY1", "normal-value"],
      };
      assert.equal(hasVaultRefs(cfg), true);
    });

    it("handles primitives", () => {
      assert.equal(hasVaultRefs(42), false);
      assert.equal(hasVaultRefs(null), false);
      assert.equal(hasVaultRefs(true), false);
      assert.equal(hasVaultRefs("$vault:KEY"), true);
      assert.equal(hasVaultRefs("not-a-ref"), false);
    });
  });

  describe("collectVaultRefs", () => {
    it("returns empty array for config without refs", () => {
      const cfg = { models: { apiKey: "sk-real" } };
      const refs = collectVaultRefs(cfg);
      assert.deepEqual(refs, []);
    });

    it("collects all vault refs with paths", () => {
      const cfg = {
        models: {
          providers: {
            anthropic: { apiKey: "$vault:ANTHROPIC_KEY" },
            openai: { apiKey: "$vault:OPENAI_KEY" },
          },
        },
        channels: {
          telegram: { botToken: "$vault:TG_TOKEN" },
        },
      };

      const refs = collectVaultRefs(cfg);
      assert.equal(refs.length, 3);

      const names = refs.map((r) => r.name).sort();
      assert.deepEqual(names, ["ANTHROPIC_KEY", "OPENAI_KEY", "TG_TOKEN"]);

      const paths = refs.map((r) => r.path).sort();
      assert.deepEqual(paths, [
        "channels.telegram.botToken",
        "models.providers.anthropic.apiKey",
        "models.providers.openai.apiKey",
      ]);
    });
  });
});

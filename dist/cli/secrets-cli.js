/**
 * HexOS CLI — `hexos secrets` command group.
 *
 * Manages the encrypted credential vault.
 *
 * Commands:
 *   set NAME "value"        — Add/update a secret
 *   list                    — List secrets (values redacted)
 *   remove NAME             — Remove a secret
 *   rotate NAME "new-value" — Rotate a secret
 *   migrate                 — Scan hexos.json and migrate keys to vault
 *   export                  — Export vault with passphrase encryption
 *   import FILE             — Import vault from encrypted backup
 *   audit                   — Show vault access log
 */

import fs from "node:fs";
import { defaultRuntime } from "../runtime.js";

export function registerSecretsCli(program) {
  const secrets = program
    .command("secrets")
    .description("Encrypted credential vault");

  // ── hexos secrets set ────────────────────────────────────────────────
  secrets
    .command("set <name> [value]")
    .description("Add or update a secret in the vault")
    .option("--from-env <var>", "Read value from environment variable")
    .option("--from-file <path>", "Read value from a file")
    .option("--tags <tags>", "Comma-separated tags")
    .option(
      "--allowed-endpoints <endpoints>",
      "Comma-separated allowed endpoint patterns"
    )
    .option("--used-by <paths>", "Comma-separated config paths that use this secret")
    .action(async (name, value, opts) => {
      const { setSecret } = await import("../vault/store.js");

      let secretValue = value;

      if (opts.fromEnv) {
        secretValue = process.env[opts.fromEnv];
        if (!secretValue) {
          defaultRuntime.error(
            `Environment variable "${opts.fromEnv}" is not set or empty`
          );
          process.exit(1);
        }
      } else if (opts.fromFile) {
        try {
          secretValue = fs.readFileSync(opts.fromFile, "utf8").trim();
        } catch (err) {
          defaultRuntime.error(`Failed to read file "${opts.fromFile}": ${err.message}`);
          process.exit(1);
        }
      }

      if (!secretValue) {
        defaultRuntime.error(
          "No value provided. Use a positional argument, --from-env, or --from-file."
        );
        process.exit(1);
      }

      const options = {};
      if (opts.tags) options.tags = opts.tags.split(",").map((t) => t.trim());
      if (opts.allowedEndpoints) {
        options.allowedEndpoints = opts.allowedEndpoints
          .split(",")
          .map((e) => e.trim());
      }
      if (opts.usedBy) options.usedBy = opts.usedBy.split(",").map((p) => p.trim());

      try {
        setSecret(name, secretValue, options);
        defaultRuntime.log(`✓ Secret "${name}" stored in vault`);
      } catch (err) {
        defaultRuntime.error(`Failed to set secret: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets list ───────────────────────────────────────────────
  secrets
    .command("list")
    .description("List all secrets (values redacted)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const { listSecrets } = await import("../vault/store.js");

      try {
        const secrets = listSecrets();
        const entries = Object.entries(secrets);

        if (entries.length === 0) {
          defaultRuntime.log("No secrets in vault. Use 'hexos secrets set' to add one.");
          return;
        }

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(secrets, null, 2));
          return;
        }

        // Table format
        const nameWidth = Math.max(
          4,
          ...entries.map(([name]) => name.length)
        );
        const valueWidth = Math.max(
          5,
          ...entries.map(([, s]) => s.redactedValue.length)
        );

        defaultRuntime.log(
          `${"NAME".padEnd(nameWidth)}  ${"VALUE".padEnd(valueWidth)}  ${"CREATED".padEnd(10)}  USED BY`
        );
        defaultRuntime.log("─".repeat(nameWidth + valueWidth + 40));

        for (const [name, secret] of entries) {
          const created = secret.createdAt
            ? secret.createdAt.slice(0, 10)
            : "unknown";
          const usedBy = (secret.usedBy || []).join(", ") || "-";
          defaultRuntime.log(
            `${name.padEnd(nameWidth)}  ${secret.redactedValue.padEnd(valueWidth)}  ${created.padEnd(10)}  ${usedBy}`
          );
        }

        defaultRuntime.log(`\n${entries.length} secret(s) in vault`);
      } catch (err) {
        defaultRuntime.error(`Failed to list secrets: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets remove ─────────────────────────────────────────────
  secrets
    .command("remove <name>")
    .description("Remove a secret from the vault")
    .action(async (name) => {
      const { removeSecret } = await import("../vault/store.js");

      try {
        const removed = removeSecret(name);
        if (removed) {
          defaultRuntime.log(`✓ Secret "${name}" removed from vault`);
        } else {
          defaultRuntime.error(`Secret "${name}" not found in vault`);
          process.exit(1);
        }
      } catch (err) {
        defaultRuntime.error(`Failed to remove secret: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets rotate ─────────────────────────────────────────────
  secrets
    .command("rotate <name> <newValue>")
    .description("Rotate a secret (update value, log rotation event)")
    .action(async (name, newValue) => {
      const { rotateSecret } = await import("../vault/store.js");

      try {
        rotateSecret(name, newValue);
        defaultRuntime.log(`✓ Secret "${name}" rotated`);
      } catch (err) {
        defaultRuntime.error(`Failed to rotate secret: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets migrate ────────────────────────────────────────────
  secrets
    .command("migrate")
    .description("Scan hexos.json for plaintext secrets and migrate to vault")
    .option("--dry-run", "Show what would be migrated without making changes")
    .option("--overwrite", "Overwrite existing vault secrets if they exist")
    .action(async (opts) => {
      const { scanConfigForMigration, migrateConfigSecretsAsync } = await import(
        "../vault/migrate.js"
      );

      try {
        if (opts.dryRun) {
          const secrets = scanConfigForMigration();

          if (secrets.length === 0) {
            defaultRuntime.log(
              "No plaintext secrets detected in config. Nothing to migrate."
            );
            return;
          }

          defaultRuntime.log("Secrets that would be migrated:\n");
          for (const s of secrets) {
            const value = s.value.slice(0, 4) + "..." + s.value.slice(-3);
            defaultRuntime.log(
              `  ${s.path} → $vault:${s.vaultName}  (${value})`
            );
            if (s.allowedEndpoints.length > 0) {
              defaultRuntime.log(
                `    Allowed endpoints: ${s.allowedEndpoints.join(", ")}`
              );
            }
          }
          defaultRuntime.log(
            `\n${secrets.length} secret(s) would be migrated. Run without --dry-run to apply.`
          );
          return;
        }

        const result = await migrateConfigSecretsAsync({
          overwrite: Boolean(opts.overwrite),
        });

        if (result.migrated === 0) {
          defaultRuntime.log(
            "No plaintext secrets found to migrate (they may already be in the vault)."
          );
          return;
        }

        defaultRuntime.log(`✓ Migrated ${result.migrated} secret(s) to vault:\n`);
        for (const s of result.secrets) {
          defaultRuntime.log(`  ${s.path} → $vault:${s.vaultName}`);
        }
        if (result.backupPath) {
          defaultRuntime.log(
            `\nOriginal config backed up to: ${result.backupPath}`
          );
        }
        defaultRuntime.log(
          "\nRestart the gateway to apply vault references."
        );
      } catch (err) {
        defaultRuntime.error(`Migration failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets export ─────────────────────────────────────────────
  secrets
    .command("export")
    .description("Export vault encrypted with a passphrase (for backup)")
    .requiredOption("--passphrase <pass>", "Passphrase for encryption")
    .option("-o, --output <file>", "Output file (default: stdout)")
    .action(async (opts) => {
      const { exportVault } = await import("../vault/store.js");

      try {
        const exported = exportVault(opts.passphrase);

        if (opts.output) {
          fs.writeFileSync(opts.output, exported, { mode: 0o600 });
          defaultRuntime.log(`✓ Vault exported to ${opts.output}`);
        } else {
          process.stdout.write(exported + "\n");
        }
      } catch (err) {
        defaultRuntime.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets import ─────────────────────────────────────────────
  secrets
    .command("import <file>")
    .description("Import vault from an encrypted backup")
    .requiredOption("--passphrase <pass>", "Passphrase for decryption")
    .option("--merge", "Merge into existing vault instead of replacing")
    .option("--overwrite", "Overwrite existing secrets when merging")
    .action(async (file, opts) => {
      const { importVault } = await import("../vault/store.js");

      try {
        const raw = fs.readFileSync(file, "utf8");
        const result = importVault(raw, opts.passphrase, {
          merge: Boolean(opts.merge),
          overwrite: Boolean(opts.overwrite),
        });

        const count = Object.keys(result.secrets).length;
        const mode = opts.merge ? "merged" : "imported";
        defaultRuntime.log(`✓ ${count} secret(s) ${mode} from backup`);
      } catch (err) {
        defaultRuntime.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── hexos secrets audit ──────────────────────────────────────────────
  secrets
    .command("audit")
    .description("Show vault access log")
    .option("--secret <name>", "Filter by secret name")
    .option("--event <type>", "Filter by event type")
    .option("-n, --limit <n>", "Number of recent events to show", "50")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const { readVaultAuditLog, getAuditLogPath } = await import(
        "../vault/audit.js"
      );

      try {
        const events = readVaultAuditLog({
          secret: opts.secret,
          event: opts.event,
          limit: parseInt(opts.limit, 10),
        });

        if (events.length === 0) {
          defaultRuntime.log(
            `No vault audit events found. Log: ${getAuditLogPath()}`
          );
          return;
        }

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(events, null, 2));
          return;
        }

        for (const event of events) {
          const ts = event.timestamp?.slice(0, 19).replace("T", " ") ?? "?";
          const secret = event.secret ?? "-";
          const action = event.action ?? event.event ?? "-";
          const detail = event.endpoint ?? event.tool ?? event.error ?? "";
          defaultRuntime.log(`  ${ts}  ${secret.padEnd(24)}  ${action.padEnd(12)}  ${detail}`);
        }

        defaultRuntime.log(`\n${events.length} event(s) shown. Full log: ${getAuditLogPath()}`);
      } catch (err) {
        defaultRuntime.error(`Audit failed: ${err.message}`);
        process.exit(1);
      }
    });
}

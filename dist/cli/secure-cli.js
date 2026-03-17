import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
export function registerSecureCli(program) {
    program
        .command("secure")
        .description("Server security hardening wizard (UFW, SSH, Fail2ban, auto-updates)")
        .option("--ssh-port <port>", "SSH port to allow (default: auto-detect or 22)")
        .option("--gateway-port <port>", "Gateway port to allow (default: 18789)")
        .option("--non-interactive", "Skip all prompts, apply all defaults", false)
        .addHelpText("after", () => `\n${theme.muted("Hardens a fresh Ubuntu VPS for production use.")}\n${theme.muted("Run as root or with sudo.")}\n`)
        .action((opts) => {
        const scriptPath = resolve(import.meta.dirname, "../../scripts/secure-server.sh");
        if (!existsSync(scriptPath)) {
            console.error(`Error: secure-server.sh not found at ${scriptPath}`);
            process.exit(1);
        }
        const args = [];
        if (opts.sshPort)
            args.push("--ssh-port", opts.sshPort);
        if (opts.gatewayPort)
            args.push("--gateway-port", opts.gatewayPort);
        if (opts.nonInteractive)
            args.push("--non-interactive");
        try {
            execSync(`bash "${scriptPath}" ${args.join(" ")}`, { stdio: "inherit" });
        }
        catch (err) {
            process.exit(err.status || 1);
        }
    });
}

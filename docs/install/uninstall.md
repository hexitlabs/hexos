---
summary: "Uninstall HexOS completely (CLI, service, state, workspace)"
read_when:
  - You want to remove HexOS from a machine
  - The gateway service is still running after uninstall
---

# Uninstall

Two paths:
- **Easy path** if `hexos` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
hexos uninstall
```

Non-interactive (automation / npx):

```bash
hexos uninstall --all --yes --non-interactive
npx -y hexos uninstall --all --yes --non-interactive
```

Manual steps (same result):

1) Stop the gateway service:

```bash
hexos gateway stop
```

2) Uninstall the gateway service (launchd/systemd/schtasks):

```bash
hexos gateway uninstall
```

3) Delete state + config:

```bash
rm -rf "${HEXOS_STATE_DIR:-$HOME/.hexos}"
```

If you set `HEXOS_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4) Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/clawd
```

5) Remove the CLI install (pick the one you used):

```bash
npm rm -g hexos
pnpm remove -g hexos
bun remove -g hexos
```

6) If you installed the macOS app:

```bash
rm -rf /Applications/HexOS.app
```

Notes:
- If you used profiles (`--profile` / `HEXOS_PROFILE`), repeat step 3 for each state dir (defaults are `~/.hexos-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `hexos` is missing.

### macOS (launchd)

Default label is `com.hexos.gateway` (or `com.hexos.<profile>`):

```bash
launchctl bootout gui/$UID/com.hexos.gateway
rm -f ~/Library/LaunchAgents/com.hexos.gateway.plist
```

If you used a profile, replace the label and plist name with `com.hexos.<profile>`.

### Linux (systemd user unit)

Default unit name is `hexos-gateway.service` (or `hexos-gateway-<profile>.service`):

```bash
systemctl --user disable --now hexos-gateway.service
rm -f ~/.config/systemd/user/hexos-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `HexOS Gateway` (or `HexOS Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "HexOS Gateway"
Remove-Item -Force "$env:USERPROFILE\.hexos\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.hexos-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://clawd.bot/install.sh` or `install.ps1`, the CLI was installed with `npm install -g hexos@latest`.
Remove it with `npm rm -g hexos` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `hexos ...` / `bun run hexos ...`):

1) Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2) Delete the repo directory.
3) Remove state + workspace as shown above.

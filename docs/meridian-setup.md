# Meridian Setup Guide — Oracle VM Ubuntu

Meridian is a proxy that bridges OpenClaw to Claude Max via the Claude Code SDK. Both services run on the same VM — all communication is over localhost.

> **Important**: The OpenClaw adapter and all related changes live in the fork at `git@github.com:dhruv-goyal-10/meridian-openclaw.git`. Do NOT install the published npm package (`@rynfar/meridian`) — it does not have these changes. Always run from this fork's source.

---

## Step 1 — Clone the fork on the VM

```bash
git clone https://github.com/dhruv-goyal-10/meridian-openclaw.git meridian
cd meridian
```

---

## Step 2 — Install Bun

The supervisor script runs TypeScript source directly via Bun — no build step needed.

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # or open a new shell
bun --version      # confirm installed
```

---

## Step 3 — Install dependencies

```bash
cd ~/meridian
bun install
```

---

## Step 4 — Authenticate with Claude Max

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

On a headless Ubuntu VM this prints a URL. Open it in any browser on any device, log in with your Claude Max account, and the VM receives the token automatically.

Verify:
```bash
claude /status
# should show your email and Max subscription
```

---

## Step 5 — Start Meridian

```bash
cd ~/meridian
MERIDIAN_PASSTHROUGH=1 MERIDIAN_WORKDIR=/home/ubuntu ./bin/claude-proxy-supervisor.sh
```

The supervisor script detects that `dist/cli.js` does not exist and automatically falls back to `bun run ./bin/cli.ts` — your source changes are picked up directly, no build required.

### As a systemd service (survives reboots)

```ini
# /etc/systemd/system/meridian.service
[Unit]
Description=Meridian Proxy
After=network.target

[Service]
ExecStart=/home/ubuntu/meridian/bin/claude-proxy-supervisor.sh
Environment=MERIDIAN_PASSTHROUGH=1
Environment=MERIDIAN_WORKDIR=/home/ubuntu
WorkingDirectory=/home/ubuntu/meridian
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable meridian
sudo systemctl start meridian
```

---

## Step 6 — Verify

```bash
curl http://localhost:3456/health
```

Expected:
```json
{
  "status": "ok",
  "auth": { "loggedIn": true, "email": "you@example.com", "subscriptionType": "max" }
}
```

If `loggedIn` is `false`, re-run `claude auth login`.

---

## How OpenClaw requests are handled

When OpenClaw connects on `localhost:3456`:

1. **Adapter detected** via `x-meridian-agent: openclaw` header (set in OpenClaw config)
2. **Passthrough mode** — OpenClaw's own tools are forwarded back to OpenClaw for execution
3. **WebSearch / WebFetch run natively** via the Claude Code SDK — not forwarded to OpenClaw
4. **Session continuity** via fingerprinting + optional `x-openclaw-session-key` header, covering all four lineage states: continuation, compaction, undo, diverged

---

## Key env vars

| Variable | Default | Set to |
|---|---|---|
| `MERIDIAN_HOST` | `127.0.0.1` | Leave as default (same machine) |
| `MERIDIAN_PORT` | `3456` | Leave as default |
| `MERIDIAN_PASSTHROUGH` | unset | **`1`** — required for OpenClaw |
| `MERIDIAN_WORKDIR` | `cwd()` | Your projects directory on the VM |
| `MERIDIAN_DEFAULT_AGENT` | `opencode` | Leave as default |
| `MERIDIAN_MAX_CONCURRENT` | `10` | Increase if running many parallel OpenClaw sessions |

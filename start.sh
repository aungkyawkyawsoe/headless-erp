#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  start.sh — one-shot local dev setup for the Headless Entity Engine monorepo
#
#  What it does:
#    1. Prompts for DB name, admin email/username, admin password (+ extras)
#    2. Writes the config files the app + CLI need:
#         apps/api/.dev.vars      (wrangler dev secrets — ADMIN_* / JWT_SECRET)
#         .env.local              (CLI login defaults — MMBIX_*)
#         apps/api/wrangler.jsonc (D1 database_name, if you changed the DB name)
#    3. Installs dependencies (pnpm install) if node_modules is missing
#    4. Builds the CLI and links it globally (headless on PATH)
#    5. Optionally scaffolds the HRM module (entities + frontend sidebar)
#    6. Shows a summary, then "Press Enter to proceed" → starts pnpm dev
#
#  Usage:
#    ./start.sh                  interactive (recommended)
#    ./start.sh --no-hrm         skip the HRM module prompt
#    ./start.sh --no-install     skip pnpm install
#    ./start.sh --no-start       prepare everything but do NOT launch dev
#    DB_NAME=... ADMIN_EMAIL=... ADMIN_PASSWORD=... ./start.sh   # non-interactive
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── flags ────────────────────────────────────────────────────────────────────
NO_HRM=0
NO_INSTALL=0
NO_START=0
for arg in "$@"; do
	case "$arg" in
		--no-hrm) NO_HRM=1 ;;
		--no-install) NO_INSTALL=1 ;;
		--no-start) NO_START=1 ;;
		-h | --help)
			echo "Usage: ./start.sh [--no-hrm] [--no-install] [--no-start]"
			echo "  --no-hrm      skip the HRM module scaffold prompt"
			echo "  --no-install  skip 'pnpm install' (assumes deps are installed)"
			echo "  --no-start    prepare everything but do NOT launch dev servers"
			exit 0
			;;
		*) echo "Unknown option: $arg" && exit 1 ;;
	esac
done

# ── colors ───────────────────────────────────────────────────────────────────
C_GREEN=$'\033[32m'; C_CYAN=$'\033[36m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
ok()  { echo "${C_GREEN}✔${C_RST} $*"; }
info(){ echo "${C_CYAN}→${C_RST} $*"; }
warn(){ echo "${C_YEL}⚠${C_RST} $*"; }
err() { echo "${C_RED}✖${C_RST} $*" >&2; }

# ── helpers ──────────────────────────────────────────────────────────────────
prompt() { # $1=message  $2=default  → prints chosen value to stdout
	local msg="$1" def="${2:-}" out
	if [[ -n "$def" ]]; then
		read -r -p "$msg [$def]: " out
		[[ -z "$out" ]] && out="$def"
	else
		read -r -p "$msg: " out
	fi
	printf '%s' "$out"
}

confirm() { # $1=message  $2=default(y|n) → 0=yes 1=no
	local msg="$1" def="${2:-n}" ans
	local hint="y/N"; [[ "$def" == "y" ]] && hint="Y/n"
	read -r -p "$msg [$hint]: " ans
	case "${ans,,}" in
		y | yes) return 0 ;;
		n | no) return 1 ;;
		*) [[ "$def" == "y" ]] ;;
	esac
}

# Escape a value for double-quoted dotenv lines (\.dev.vars style)
dotenv_quote() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

require() { # $1=binary  $2=label
	if ! command -v "$1" >/dev/null 2>&1; then
		err "$2 is required but not installed."
		exit 1
	fi
}

# ── 0. banner + prerequisites ────────────────────────────────────────────────
echo
echo "${C_CYAN}┌────────────────────────────────────────────────────────────┐${C_RST}"
echo "${C_CYAN}│   Headless Entity Engine — local dev setup                  │${C_RST}"
echo "${C_CYAN}└────────────────────────────────────────────────────────────┘${C_RST}"
echo

require node "Node.js (>= 20)"
require pnpm "pnpm"

node -e 'const [maj]=process.versions.node.split(".").map(Number); process.exit(maj<20?1:0)' \
	|| { err "Node.js >= 20 required (found $(node -v))."; exit 1; }
ok "node $(node -v) · pnpm $(pnpm --version 2>/dev/null | tail -1)"

# ── 1. prompts ───────────────────────────────────────────────────────────────
# Current defaults (read from infra/env.prod — the single source of truth for
# the D1 name — and the existing .dev.vars so re-runs keep your choices)
CUR_DB="$(grep -E '^D1_NAME=' infra/env.prod 2>/dev/null | head -1 | cut -d'=' -f2)"
CUR_DB="${CUR_DB:-mff-sys-db}"
# Reuse the email from a previously generated .dev.vars (never hardcoded)
CUR_EMAIL="$(grep '^ADMIN_USERNAME=' apps/api/.dev.vars 2>/dev/null | head -1 | cut -d'"' -f2)"

echo "${C_DIM}(press Enter to accept the default shown in brackets)${C_RST}"
echo

# DB name (D1) — lowercase letters, digits, hyphens only
while :; do
	DB_NAME="${DB_NAME:-$(prompt "Database name (D1)" "$CUR_DB")}"
	if [[ "$DB_NAME" =~ ^[a-z0-9-]+$ ]]; then break; fi
	err "DB name may only contain lowercase letters, digits and hyphens."
	DB_NAME=""
done
ok "DB name: $DB_NAME"

# Admin username (email)
while :; do
	ADMIN_EMAIL="${ADMIN_EMAIL:-$(prompt "Admin username (email)" "$CUR_EMAIL")}"
	if [[ "$ADMIN_EMAIL" == *"@"* ]]; then break; fi
	err "Admin username must be a valid email address."
	ADMIN_EMAIL=""
done
ok "Admin email: $ADMIN_EMAIL"

ADMIN_NAME="${ADMIN_NAME:-$(prompt "Admin display name" "Administrator")}"
[[ -z "$ADMIN_NAME" ]] && ADMIN_NAME="Administrator"
ok "Admin name: $ADMIN_NAME"

# Admin password (hidden, min 8 chars, confirm) — no defaults, always prompted
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
	while :; do
		echo -n "Admin password (min 8 chars): "
		read -rs PASS1; echo
		if [[ -z "$PASS1" ]]; then err "Password cannot be empty."; continue; fi
		if (( ${#PASS1} < 8 )); then err "Password must be at least 8 characters."; continue; fi
		echo -n "Confirm password: "
		read -rs PASS2; echo
		if [[ "$PASS1" != "$PASS2" ]]; then err "Passwords do not match — try again."; continue; fi
		break
	done
	ADMIN_PASSWORD="$PASS1"
fi
ok "Admin password: set (${#ADMIN_PASSWORD} chars)"

# JWT secret — always auto-generated, never prompted
JWT_SECRET="${JWT_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}"

# HRM module?
HRM_DO=0
if [[ "$NO_HRM" == "1" ]]; then
	echo "${C_DIM}--no-hrm: skipping HRM module scaffold${C_RST}"
elif [[ -n "${HRM:-}" ]]; then
	[[ "$HRM" == "1" || "${HRM,,}" == "y" || "${HRM,,}" == "yes" ]] && HRM_DO=1
else
	if confirm "Scaffold the HRM module (entities + frontend sidebar)?" "y"; then HRM_DO=1; fi
fi

# ── 2. write config files ────────────────────────────────────────────────────
echo
info "Writing configuration files..."

mkdir -p apps/api

# apps/api/.dev.vars — wrangler dev secrets (double-quoted, like .dev.vars.example)
if [[ -f apps/api/.dev.vars ]]; then
	cp apps/api/.dev.vars apps/api/.dev.vars.bak
	warn "apps/api/.dev.vars exists — backed up to apps/api/.dev.vars.bak"
fi
{
	echo "# Generated by ./start.sh — local dev secrets (git-ignored)."
	echo "# Production: use 'npx wrangler secret put' instead — never commit this file."
	echo "ADMIN_USERNAME=\"$(dotenv_quote "$ADMIN_EMAIL")\""
	echo "ADMIN_PASSWORD=\"$(dotenv_quote "$ADMIN_PASSWORD")\""
	echo "ADMIN_NAME=\"$(dotenv_quote "$ADMIN_NAME")\""
	echo "JWT_SECRET=\"$(dotenv_quote "$JWT_SECRET")\""
	# LOCAL-ONLY dev mode — enables the publicly-known dev-token + relaxed rate
	# limits. Never set IS_DEV in production vars (wrangler.jsonc `vars`).
	echo "IS_DEV=true"
} > apps/api/.dev.vars
ok "apps/api/.dev.vars"

# .env.local — CLI login defaults (auto-loaded by `headless` from the project root)
if [[ -f .env.local ]]; then
	cp .env.local .env.local.bak
	warn ".env.local exists — backed up to .env.local.bak"
fi
{
	echo "# Generated by ./start.sh — local CLI login defaults (git-ignored)"
	echo "MMBIX_ADMIN_EMAIL=$ADMIN_EMAIL"
	echo "MMBIX_ADMIN_PASSWORD=$ADMIN_PASSWORD"
	echo "MMBIX_API_URL=http://localhost:8788"
} > .env.local
ok ".env.local"

# D1 database name — infra/env.prod is the source of truth; wrangler.jsonc is
# generated from it and must NOT be hand-edited (pnpm gen:infra / check:infra).
# A local-only DB name change therefore can't be applied here anymore: edit
# D1_NAME in infra/env.prod and run `pnpm gen:infra` if you truly need to rename.
if [[ "$DB_NAME" != "$CUR_DB" ]]; then
	warn "Local DB name \"$DB_NAME\" differs from infra/env.prod (\"$CUR_DB\") — wrangler.jsonc is generated, so it was NOT rewritten."
	warn "The prompt default is kept from infra/env.prod; change D1_NAME there + \"pnpm gen:infra\" to rename."
fi
ok "DB name (from infra/env.prod): $CUR_DB"

# NOTE: vars.ADMIN_USERNAME in wrangler.jsonc is generated from infra/env.prod
# (and .dev.vars overrides it locally) — start.sh no longer rewrites the
# committed config.

# ── 3. install dependencies ──────────────────────────────────────────────────
echo
if [[ "$NO_INSTALL" == "1" ]]; then
	echo "${C_DIM}--no-install: skipping pnpm install${C_RST}"
elif [[ -d node_modules ]]; then
	ok "node_modules present — skipping install (rm -rf node_modules && ./start.sh to force)"
else
	info "Installing dependencies (pnpm install)…"
	pnpm install
	ok "dependencies installed"
fi

# ── 4. build + link the CLI ──────────────────────────────────────────────────
echo
info "Building the CLI…"
( cd packages/cli && node build.js )
ok "CLI built"

GBIN="$(pnpm config get global-bin-dir 2>/dev/null || true)"
if [[ -z "$GBIN" || "$GBIN" == "undefined" ]]; then
	warn "pnpm global bin dir not configured — running 'pnpm setup' (writes to ~/.zshrc / ~/.bashrc)"
	pnpm setup
fi
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PATH="$PNPM_HOME:$PATH"
( cd packages/cli && pnpm link --global ) >/dev/null 2>&1 || {
	err "'pnpm link --global' failed — run it manually from packages/cli:"
	echo "    cd packages/cli && pnpm link --global"
	exit 1
}
ok "CLI linked globally"
command -v headless >/dev/null 2>&1 && ok "headless on PATH ($(headless --version))" \
	|| warn "open a new terminal (or 'source ~/.zshrc') for 'headless' to be on PATH"

# ── 5. summary + final proceed ───────────────────────────────────────────────
echo
echo "${C_GREEN}─────────────────────────── READY TO GO ───────────────────────────${C_RST}"
echo "  Database (D1)     : $DB_NAME"
echo "  Admin username    : $ADMIN_EMAIL"
echo "  Admin name        : $ADMIN_NAME"
echo "  Admin password    : ${ADMIN_PASSWORD:0:3}•••••• (${#ADMIN_PASSWORD} chars)"
echo "  HRM module        : $([[ $HRM_DO == 1 ]] && echo "scaffold after API is up" || echo "not requested")"
echo "  API (local)       : http://localhost:8788  (api docs: /api/docs)"
echo "  Admin UI (local)  : http://localhost:5173"
echo "${C_DIM}──────────────────────────────────────────────────────────────────────${C_RST}"
echo "${C_DIM}မှတ်ချက် — dev login အတွက် ADMIN_EMAIL / ADMIN_PASSWORD ကို သုံးပါ။${C_RST}"

if [[ "$NO_START" == "1" ]]; then
	echo
	ok "Setup complete (--no-start). To launch manually:"
	echo "    pnpm dev"
	exit 0
fi

echo
echo "${C_YEL}One final step — press Enter to start the dev servers (Ctrl+C to abort).${C_RST}"
read -r -p "" _

# ── 6. start dev servers + (optional) HRM scaffold ───────────────────────────
info "Starting dev servers (pnpm dev → API :8788 · Admin UI :5173)…"
pnpm dev &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true; echo; echo "Dev servers stopped."' INT TERM

# Wait until the API answers /api/health (first boot can take a while)
info "Waiting for the API at http://localhost:8788/api/health…"
READY=0
for _ in $(seq 1 120); do
	if node -e "fetch('http://localhost:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
		READY=1; break
	fi
	if ! kill -0 "$DEV_PID" 2>/dev/null; then
		err "The dev server exited before becoming ready. Check the logs above."
		exit 1
	fi
	sleep 1
done

if [[ "$READY" != "1" ]]; then
	err "API did not become ready within 120s. Check the logs above."
	exit 1
fi
ok "API is up — http://localhost:8788/api/health"

# Optional: scaffold the HRM module once the API is live
if [[ "$HRM_DO" == "1" ]]; then
	echo
	info "Scaffolding the HRM module (entities + frontend sidebar)…"
	export MMBIX_ADMIN_EMAIL="$ADMIN_EMAIL"
	export MMBIX_ADMIN_PASSWORD="$ADMIN_PASSWORD"
	export MMBIX_API_URL="http://localhost:8788"

	headless module create --template hrm 2>&1 || warn "HRM module scaffold failed — it may already exist (that's fine)."
	node apps/api/scripts/seed-hrm-entities.mjs || warn "HRM entity seed had errors — see output above."

	echo
	ok "HRM module ready."
fi

echo
ok "Everything is ready — open http://localhost:5173 and log in with:"
echo "    $ADMIN_EMAIL / ${ADMIN_PASSWORD:0:3}••••••"
echo "Press Ctrl+C to stop the dev servers."

wait "$DEV_PID"

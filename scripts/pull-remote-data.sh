#!/usr/bin/env sh
# Pull remote D1 + R2 data into local wrangler dev state (apps/api/.wrangler/state).
#
# ── D1 needs an API token ─────────────────────────────────────────────────────
# `wrangler d1 export` rejects wrangler OAuth tokens with "Authentication error
# [code: 10000]" — Cloudflare gates the D1 export API to API tokens only.
#   1. https://dash.cloudflare.com/profile/api-tokens → Create Token → Custom
#   2. Permissions:  Account | D1 | Edit   (add Account | R2 | Read for the R2 sync)
#   3. Run with:
#        export CLOUDFLARE_API_TOKEN=<your-token>
#        sh scripts/pull-remote-data.sh
#   The R2 sync alone works with the plain wrangler OAuth login:
#        node scripts/sync-r2-to-local.mjs
#
# Resource names/account come from infra/env.prod — the single source of truth
# (the same file that generates the wrangler configs).
#
# ── Download robustness ───────────────────────────────────────────────────────
# `wrangler d1 export` creates the export, prints a presigned download URL, then
# downloads it itself — that final fetch is flaky on some networks ("fetch
# failed" / connection reset). This script captures the printed URL and retries
# the download with curl, and if that still fails, falls back to
# scripts/d1-export-via-api.mjs (reconstructs the dump via api.cloudflare.com,
# which avoids the presigned-URL leg entirely).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"
cd "$API_DIR"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
	echo "❌ CLOUDFLARE_API_TOKEN is not set — D1 export requires an API token."
	echo "   Create one at https://dash.cloudflare.com/profile/api-tokens"
	echo "   (Account › D1 › Edit; add Account › R2 › Read to also cover the R2 sync),"
	echo "   then re-run with:"
	echo "     export CLOUDFLARE_API_TOKEN=<your-token>"
	echo "     sh scripts/pull-remote-data.sh"
	echo ""
	echo "   R2-only (works with your current wrangler login):"
	echo "     node scripts/sync-r2-to-local.mjs"
	exit 1
fi

# Infra SSOT — account id + D1 + R2 names (exported for the wrangler calls).
# shellcheck disable=SC1091
set -a
. "$SCRIPT_DIR/../infra/env.prod"
set +a

DUMP="/tmp/${D1_NAME:-mff-sys-db}-remote.sql"
LOG="/tmp/${D1_NAME:-mff-sys-db}-export.log"

echo "① Exporting remote D1 ($D1_NAME)…"
rm -f "$DUMP" "$LOG"
npx wrangler d1 export "$D1_NAME" --remote --output "$DUMP" -y 2>&1 | tee "$LOG" || true

if [ -s "$DUMP" ]; then
	echo "   ✓ downloaded by wrangler"
else
	URL="$(grep -oE 'https://[^ ]+' "$LOG" | head -1)"
	if [ -z "$URL" ]; then
		echo "❌ Export failed and no presigned URL was printed (see $LOG)."
		exit 1
	fi
	echo "   ⚠️ wrangler download failed — fetching presigned URL with curl (retries)…"
	if ! curl -fL --retry 5 --retry-all-errors --retry-delay 2 -o "$DUMP" "$URL"; then
		echo "   ⚠️ Presigned download failed too — reconstructing dump via api.cloudflare.com…"
		node "$SCRIPT_DIR/d1-export-via-api.mjs" > "$DUMP"
	fi
fi

test -s "$DUMP" || { echo "❌ Could not obtain a D1 dump."; exit 1; }
echo "   ✓ dump ready ($(wc -c < "$DUMP" | tr -d ' ') bytes)"

echo "② Resetting local D1 state (.wrangler/state/v3/d1)…"
rm -rf .wrangler/state/v3/d1

echo "③ Importing dump into local D1…"
npx wrangler d1 execute "$D1_NAME" --local --file "$DUMP" -y

echo "④ Syncing R2 ($R2_BUCKET) → local…"
node "$SCRIPT_DIR/sync-r2-to-local.mjs"

echo ""
echo "✅ Done. Restart \`wrangler dev\` (apps/api) to pick up the data."

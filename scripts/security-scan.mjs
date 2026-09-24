#!/usr/bin/env node
/**
 * Security scan — flags leftover debug artifacts in committed source.
 *
 * Replaces the old `grep ... || true` one-liner (which could never fail and
 * flooded on packages/cli's own output channel). Exits 1 when anything is
 * found, so CI / `pnpm security` actually gates.
 *
 * Exclusions (all deliberate, mirror .husky/pre-commit):
 *   - packages/cli/**        — the CLI is a terminal tool; console.log IS its
 *                              output channel (never debug noise).
 *   - *.stories.tsx          — Storybook demo handlers use console.log on
 *                              purpose.
 *   - <app|package>/scripts/** (build tooling) — build + seed scripts log to
 *     stdout by design; the root `scripts/` dir IS scanned.
 *   - structured worker logging lines (JSON.stringify / `[webhook]` /
 *     `[migration]`) — stdout is the Workers runtime logging channel.
 *   - comment lines (//, *, /*) — doc examples, not real calls.
 *   - build artifacts: node_modules, dist, .turbo, .wrangler, .git, .cache,
 *     .playwright-mcp, studio.db, bin/ (bundled CLI), *.d.ts.
 *
 * Note: the flagged patterns are written in character classes below so this
 * script does not match itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const SCAN_DIRS = ['apps', 'packages', 'scripts']
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.turbo', '.wrangler', '.git', '.cache',
  '.playwright-mcp', 'studio.db', 'bin', '.vite', 'coverage',
])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

// debugger / focused test runners are never legit in committed code; console.log
// is only suspicious in non-CLI app code (the allow-list below covers the
// legitimate worker-observability uses).
const SUSPECT = new RegExp(
  '(^|[^A-Za-z])(debu[g]ger|\\.only\\(|fit\\(|fdescribe\\()|console\\.log\\(',
)
// Structured worker logging (stdout is the runtime log channel) — allowed.
const ALLOWED_LOGGING = new RegExp('console\\.log\\(\\s*JSON\\.stringify|\\[webhook\\]|\\[migration\\]')
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

function readFileSafe(p) {
  try {
    if (statSync(p).size > 1_000_000) return ''
    return readFileSync(p, 'utf-8')
  } catch {
    return ''
  }
}

const rel = (p) => path.relative(ROOT, p)
const isCli = (p) => rel(p).startsWith('packages/cli/')
const isStories = (p) => rel(p).endsWith('.stories.tsx')
// `apps/*/scripts`, `packages/*/scripts` = build/seed tooling (legit stdout
// output channel). Root `scripts/` (no leading slash) IS scanned.
const isBuildTooling = (p) => /\/scripts\//.test(rel(p))

const findings = []
	for (const dir of SCAN_DIRS) {
	  for (const file of walk(path.join(ROOT, dir))) {
	    if (isCli(file) || isStories(file) || isBuildTooling(file)) continue
	    // Root scripts/** + package build.js are operational tooling: their console
	    // IS the output channel (seeds, reconciles, one-shot fixes). Still flag
	    // debugger / focused-test accidents there.
	    const relFile = rel(file)
	    const isOpsTooling = relFile.startsWith('scripts/') || /(^|\/)build\.m?js$/.test(relFile)
	    const lines = readFileSafe(file).split('\n')
	    lines.forEach((line, i) => {
	      if (COMMENT_LINE.test(line)) return
	      if (!SUSPECT.test(line)) return
	      const onlyDebug = /debu[g]ger|\.only\(|fit\(|fdescribe\(/.test(line)
	      if (isOpsTooling && /console\.log\(/.test(line) && !onlyDebug) return
	      if (ALLOWED_LOGGING.test(line)) return
	      // Multi-line structured logging: `console.log(\n  JSON.stringify({...}))`
	      const next = (lines[i + 1] ?? '').trim()
	      const isStructured = next.startsWith('JSON.stringify')
	      if (isStructured && !onlyDebug) return
	      findings.push(`${relFile}:${i + 1}: ${line.trim()}`)
	    })
	  }
	}

// ─── Config + secret hygiene (the committed wrangler config is the deploy artifact) ───
const PROD_CONFIG = path.join(ROOT, 'apps/api/wrangler.jsonc')
const prodCfg = readFileSafe(PROD_CONFIG)
// Secret keys must never appear in the prod config — vars are plaintext-visible
// in the dashboard and repo; secrets are `wrangler secret put` only. (The
// generator never emits them, so a match means a hand edit slipped past check:infra.)
const SECRET_KEY_RE = /"(ADMIN_PASSWORD|JWT_SECRET|BACKUP_ENCRYPTION_KEY|R2_SQL_TOKEN|TELEGRAM_BOT_TOKEN|ENCRYPTION_KEY)"\s*:/g
for (const m of prodCfg.matchAll(SECRET_KEY_RE)) {
  findings.push(`${rel(PROD_CONFIG)}: contains secret key ${m[1]} in vars — use \`wrangler secret put ${m[1]}\` instead`)
}
if (/"IS_DEV"\s*:\s*"true"/.test(prodCfg)) {
  findings.push(`${rel(PROD_CONFIG)}: IS_DEV=true must NEVER be set in production vars (full-admin dev-token)`)
}
// infra/env.prod (the committed SSOT) must not define secret keys either — the
// generator only emits its fixed vars list, so a stray secret there would be
// ignored by the configs but still leak in plaintext. env.testco is exempt: it
// intentionally carries KNOWN test-only placeholders.
const SECRET_KEYS = ['ADMIN_PASSWORD', 'JWT_SECRET', 'BACKUP_ENCRYPTION_KEY', 'R2_SQL_TOKEN', 'TELEGRAM_BOT_TOKEN', 'ENCRYPTION_KEY']
for (const line of readFileSafe(path.join(ROOT, 'infra/env.prod')).split(/\r?\n/)) {
  const key = line.split('=')[0].trim()
  if (SECRET_KEYS.includes(key)) {
    findings.push(`${rel(path.join(ROOT, 'infra/env.prod'))}: defines secret ${key} — env files are committed, use \`wrangler secret put\` instead`)
  }
}
// The credentials that leaked in the initial commit must never reappear in any file.
const LEAKED = ['123@Asd001', '6yVfcGaWL0+wtOSjA+lzML59soua3DOcCfkGbjPKLcA=']
const SEC_TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sh', '.json', '.jsonc', '.md', '.yml', '.yaml', '.toml'])
function walkText(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name === '.github') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkText(full))
    else if (SEC_TEXT_EXT.has(path.extname(entry.name))) out.push(full)
  }
  return out
}
for (const dir of [...SCAN_DIRS, 'infra']) {
  for (const file of walkText(path.join(ROOT, dir))) {
    if (rel(file) === 'scripts/security-scan.mjs') continue // the deny-list lives here
    const content = readFileSafe(file)
    for (const literal of LEAKED) {
      if (content.includes(literal)) {
        findings.push(`${rel(file)}: contains a previously-leaked production credential — rotate + delete`)
      }
    }
  }
}

if (findings.length > 0) {
  process.stdout.write('Security scan found:\n')
  for (const f of findings) process.stdout.write(`  ${f}\n`)
  process.stdout.write('Fix or remove the flagged debug/test-helper calls.\n')
  process.exit(1)
}
process.stdout.write('✓ security scan clean\n')

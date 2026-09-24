/**
 * HTML Sanitizer — allowlist-based, zero-dependency, deterministic.
 *
 * Runs on the Workers runtime (no DOMParser available), so it is a pure
 * regex/string transform: one linear pass, same output for the same input.
 *
 * Strategy (defense in depth at the WRITE boundary):
 *  1. Drop dangerous container elements WITH their content (script, style,
 *     iframe, object, embed, form controls, svg, math, link, meta, base).
 *  2. Strip comments.
 *  3. Keep ONLY allowlisted tags; strip every attribute except `a[href]`
 *     (http/https/mailto/tel only — `javascript:` etc. are dropped) and
 *     `td/th[colspan|rowspan]` (numeric). Event handlers can never survive
 *     because no attribute other than href/colspan/rowspan is ever kept.
 *
 * Applied to `text_editor` and `markdown` schema fields by `splitRowData`
 * (packages/core) so stored rich text can never carry executable markup.
 */

const ALLOWED_TAGS = new Set([
	'p',
	'br',
	'b',
	'strong',
	'i',
	'em',
	'u',
	's',
	'strike',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'a',
	'blockquote',
	'pre',
	'code',
	'span',
	'div',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'hr',
	'figure',
	'figcaption',
]);

/** Container tags removed WITH their content — no nesting trick can smuggle these. */
const DANGEROUS_CONTAINERS =
	/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|option|optgroup|svg|math|link|meta|base|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

/** Self-closing / void forms of the same dangerous tags. */
const DANGEROUS_VOID = /<\s*(script|style|iframe|object|embed|link|meta|base|input|button)\b[^>]*\/?>/gi;

const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Anything that still looks like a tag after allowlisting. */
const TAG_RE = /<(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g;

const SAFE_HREF_RE = /^https?:\/\//i;
const SAFE_HREF_NO_SCHEME = /^(mailto|tel):/i;

/** Decode the handful of HTML entities a scheme-smuggler can use — then re-check. */
function decodeEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(parseInt(d, 10)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"');
}

function safeHref(raw: string): string | null {
	// Control chars (incl. tab/newline) can smuggle schemes past naive checks;
	// entity-encoded schemes (java&#x73;cript:) decode AFTER our check unless we
	// decode first — so decode, then validate the decoded form.
	const clean = decodeEntities(raw.replace(/[\u0000-\u001F\u007F]/g, '').trim());
	if (!clean) return null;
	// Protocol-relative URLs (//evil.com) resolve to the CURRENT scheme in the
	// browser — they bypass the scheme check below, so reject them outright.
	if (clean.startsWith('//')) return null;
	// Anything with a scheme must be an explicit safe one; bare paths are allowed.
	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(clean);
	if (scheme) {
		if (!SAFE_HREF_RE.test(clean) && !SAFE_HREF_NO_SCHEME.test(clean)) return null;
	}
	// HTML-encode quotes so the attribute can never break out of its delimiter.
	return clean.replace(/"/g, '&quot;');
}

function safeAttrs(tag: string, attrs: string): string {
	const out: string[] = [];
	if (tag === 'a') {
		const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
		if (href !== undefined) {
			const clean = safeHref(href);
			if (clean !== null) out.push(`href="${clean}"`);
		}
		// A link that opens in a new tab must never hand its opener a handle on
		// this window (tab-nabbing) — keep target="_blank" only with the noopener
		// rel, and strip any other target value.
		if (/target\s*=\s*["']\s*_blank\s*["']/i.test(attrs)) {
			out.push('target="_blank"', 'rel="noopener noreferrer"');
		}
	}
	if (tag === 'td' || tag === 'th') {
		const colspan = /colspan\s*=\s*["']?\s*(\d+)\s*["']?/i.exec(attrs);
		const rowspan = /rowspan\s*=\s*["']?\s*(\d+)\s*["']?/i.exec(attrs);
		if (colspan) out.push(`colspan="${colspan[1]}"`);
		if (rowspan) out.push(`rowspan="${rowspan[1]}"`);
	}
	return out.length > 0 ? ` ${out.join(' ')}` : '';
}

export function sanitizeHtml(input: unknown): string {
	if (input === null || input === undefined) return '';
	const raw = String(input);
	// Fast path: plain text (the overwhelmingly common case) — no tag scan needed.
	if (!/<[a-zA-Z/!]/.test(raw)) return raw;

	return raw
		.replace(DANGEROUS_CONTAINERS, '')
		.replace(DANGEROUS_VOID, '')
		.replace(COMMENT_RE, '')
		.replace(TAG_RE, (_m, close: string, name: string, attrs: string) => {
			const tag = name.toLowerCase();
			if (close) return ALLOWED_TAGS.has(tag) ? `</${tag}>` : '';
			if (!ALLOWED_TAGS.has(tag)) return '';
			if (tag === 'br') return '<br>';
			return `<${tag}${safeAttrs(tag, attrs)}>`;
		});
}

export default sanitizeHtml;

/**
 * Prompt → DesignDNA — a DETERMINISTIC parser.
 *
 * The headline "prompt → app" path needs DNA even when no design source produced
 * one. Rather than spend tokens on an LLM for the common case, this reads a
 * plain-English prompt with pinned rules: a collection name, then field phrases
 * that may carry an explicit format (`amount: currency`, `due date (date)`).
 * Same prompt ⇒ same DNA ⇒ same proposal. An LLM fallback remains a policy
 * option (`allow_llm_fallback`) but is never required for the deterministic path.
 */

import type { DesignDNA, DesignHint } from '@mmbix/types';
import { snakeName } from '@mmbix/core';

const MAX_PROMPT = 4_000;
const MAX_FIELDS = 40;

/** Format words a prompt may use → the DesignHint sample format. */
const FORMAT_WORDS: Array<{ test: RegExp; format: NonNullable<DesignHint['sampleFormat']> }> = [
	{ test: /\b(currency|money|price|amount|cost)\b/, format: 'currency' },
	{ test: /\b(date|day)\b/, format: 'date' },
	{ test: /\b(email|e-mail)\b/, format: 'email' },
	{ test: /\b(phone|mobile|tel)\b/, format: 'phone' },
	{ test: /\b(number|numeric|int(eger)?|qty|quantity|count)\b/, format: 'number' },
	{ test: /\b(bool(ean)?|yes\/no|true\/false|flag)\b/, format: 'boolean' },
	{ test: /\b(text|string)\b/, format: 'text' },
];

function formatOf(phrase: string): DesignHint['sampleFormat'] | undefined {
	for (const f of FORMAT_WORDS) if (f.test.test(phrase)) return f.format;
	return undefined;
}

/** The collection name: text before "with", or an explicit "for/of X", else the head. */
function parseName(prompt: string): string {
	const beforeWith = prompt.split(/\bwith\b/i)[0]?.trim();
	const source = beforeWith && beforeWith.length >= 3 ? beforeWith : prompt;
	const explicit = source.match(/\b(?:for|of)\s+([a-z][a-z0-9 _-]{2,40})/i);
	const candidate = (explicit?.[1] ?? source).replace(/[^a-z0-9 _-]/gi, ' ').trim();
	return candidate.split(/\s+/).slice(0, 4).join(' ') || 'New Collection';
}

/** Split the "fields" portion of a prompt into phrases. */
function parsePhrases(prompt: string): string[] {
	const withMatch = prompt.match(/\bwith\b([\s\S]*)$/i);
	const tail = withMatch ? withMatch[1] : prompt;
	return tail
		.split(/[,;\n]|\band\b/i)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, MAX_FIELDS);
}

/** Strip a trailing `: format` / `(format)` / `- format` annotation from a label. */
function parseHint(phrase: string): DesignHint | null {
	const explicit = phrase.match(/^(.+?)\s*[:(-]\s*([a-z/ ]+)\)?\s*$/i);
	const labelRaw = (explicit?.[1] ?? phrase).replace(/^(?:a|an|the|also|include|has|have)\s+/i, '').trim();
	const label = labelRaw
		.replace(/[^a-z0-9 _-]/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!label) return null;
	const formatWord = explicit?.[2] ?? '';
	const sampleFormat = formatOf(formatWord) ?? formatOf(label);
	return sampleFormat ? { label, sampleFormat } : { label };
}

/** Parse a prompt into a provider-`manual`, deterministic `DesignDNA`. */
export function promptToDesignDNA(prompt: string): DesignDNA {
	const text = prompt.slice(0, MAX_PROMPT).trim();
	const name = parseName(text);
	const hints = parsePhrases(text)
		.map(parseHint)
		.filter((h): h is DesignHint => h !== null);
	return {
		source: { provider: 'manual', screenId: snakeName(name) || name },
		screens: [
			{
				id: snakeName(name) || 'screen',
				anatomy: text,
				components: [{ kind: 'form', label: name, ...(hints.length ? { hints } : {}) }],
			},
		],
	};
}

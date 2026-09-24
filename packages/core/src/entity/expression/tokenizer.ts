/**
 * Tokenizer — splits an expression string into tokens.
 * Bracket characters ([ ]) tokenize as parens so the parser can build
 * array literals (IN(doc.status, ['new', 'approved'])).
 */

export type TokenType = 'num' | 'str' | 'ident' | 'op' | 'paren' | 'eof';

export interface Token {
	type: TokenType;
	value: string;
	pos: number;
}

export function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const len = input.length;

	while (i < len) {
		const ch = input[i];

		// Skip whitespace
		if (/\s/.test(ch)) {
			i++;
			continue;
		}

		// Numbers
		if (/[0-9.]/.test(ch) && (ch !== '.' || /[0-9]/.test(input[i + 1] ?? ''))) {
			let num = '';
			while (i < len && /[0-9.]/.test(input[i])) {
				num += input[i];
				i++;
			}
			tokens.push({ type: 'num', value: num, pos: i });
			continue;
		}

		// Strings
		if (ch === "'" || ch === '"') {
			const quote = ch;
			i++;
			let str = '';
			while (i < len && input[i] !== quote) {
				if (input[i] === '\\' && i + 1 < len) {
					str += input[i + 1];
					i += 2;
					continue;
				}
				str += input[i];
				i++;
			}
			i++; // closing quote
			tokens.push({ type: 'str', value: str, pos: i });
			continue;
		}

		// Identifiers (letters, _, $) — dots are NOT part of identifiers (member access)
		if (/[a-zA-Z_$]/.test(ch)) {
			let id = '';
			while (i < len && /[a-zA-Z0-9_$]/.test(input[i])) {
				id += input[i];
				i++;
			}
			tokens.push({ type: 'ident', value: id, pos: i });
			continue;
		}

		// Multi-char operators
		const two = input.slice(i, i + 2);
		const three = input.slice(i, i + 3);
		if (three === '===' || three === '!==') {
			// Treat strict equality as loose (=== is not representable; values are primitives)
			tokens.push({ type: 'op', value: three.slice(0, 2), pos: i });
			i += 3;
			continue;
		}
		if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
			tokens.push({ type: 'op', value: two, pos: i });
			i += 2;
			continue;
		}

		// Single-char operators (brackets tokenize as parens → array literals)
		if ('+-*/%<>=!(),.[]'.includes(ch)) {
			tokens.push({
				type: ch === '(' || ch === ')' || ch === '[' || ch === ']' ? 'paren' : 'op',
				value: ch,
				pos: i,
			});
			i++;
			continue;
		}

		// Unknown char — skip
		i++;
	}

	tokens.push({ type: 'eof', value: '', pos: len });
	return tokens;
}

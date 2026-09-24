/**
 * HTML Sanitizer Tests — the security boundary for stored rich text.
 * Every case here is a stored-XSS attempt that must come out inert.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../html';

describe('sanitizeHtml', () => {
	it('passes plain text through unchanged', () => {
		expect(sanitizeHtml('လစဉ်လစာကို ထုတ်ယူနိုင်ပါသည်။')).toBe('လစဉ်လစာကို ထုတ်ယူနိုင်ပါသည်။');
		expect(sanitizeHtml('')).toBe('');
		expect(sanitizeHtml(null)).toBe('');
		expect(sanitizeHtml(123)).toBe('123');
	});

	it('keeps allowlisted formatting tags and their content', () => {
		const html = '<h2>Title</h2><p>Hello <strong>bold</strong> and <em>it</em></p><ul><li>one</li></ul>';
		expect(sanitizeHtml(html)).toBe('<h2>Title</h2><p>Hello <strong>bold</strong> and <em>it</em></p><ul><li>one</li></ul>');
	});

	it('removes <script> blocks with their content', () => {
		expect(sanitizeHtml('<p>ok</p><script>alert(1)</script><p>after</p>')).toBe('<p>ok</p><p>after</p>');
	});

	it('removes script variants that dodge naive regexes', () => {
		expect(sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toContain('alert');
		expect(sanitizeHtml('<SCRIPT SRC="//evil.example/x.js"></SCRIPT>')).not.toContain('evil');
		expect(sanitizeHtml('<<script>alert(1)</script>')).not.toContain('alert');
	});

	it('removes style/iframe/object/embed/form/svg with content', () => {
		const html =
			'<p>a</p><style>body{display:none}</style><iframe src="https://evil.example"></iframe><svg onload="alert(1)"></svg><form><input name="x"></form><p>b</p>';
		const out = sanitizeHtml(html);
		expect(out).toBe('<p>a</p><p>b</p>');
	});

	it('strips every attribute except safe a[href] and numeric cell spans', () => {
		expect(sanitizeHtml('<p onclick="alert(1)" class="x" style="color:red">text</p>')).toBe('<p>text</p>');
		// target="_blank" is kept ONLY when paired with rel=noopener (tab-nabbing)
		expect(sanitizeHtml('<a href="https://example.com" onclick="alert(1)" target="_blank">link</a>')).toBe(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>',
		);
		expect(sanitizeHtml('<td colspan="2" rowspan="3" data-x="1">cell</td>')).toBe('<td colspan="2" rowspan="3">cell</td>');
	});

	it('blocks javascript: / data: / vbscript: hrefs and entity-obfuscated schemes', () => {
		expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(sanitizeHtml('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')).toBe('<a>x</a>');
		expect(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>');
		// entity-encoded colon decodes to javascript: in the browser — must be dropped
		expect(sanitizeHtml('<a href="java&#x73;cript:alert(1)">x</a>')).toBe('<a>x</a>');
		expect(sanitizeHtml('<a href="java&#58;script:alert(1)">x</a>')).toBe('<a>x</a>');
		// protocol-relative //evil.com bypasses the scheme check — must be dropped
		expect(sanitizeHtml('<a href="//evil.com">x</a>')).toBe('<a>x</a>');
		expect(sanitizeHtml('<a href="&#x2F;&#x2F;evil.com">x</a>')).toBe('<a>x</a>');
	});

	it('allows relative + mailto/tel hrefs', () => {
		expect(sanitizeHtml('<a href="/docs/1">d</a>')).toBe('<a href="/docs/1">d</a>');
		expect(sanitizeHtml('<a href="mailto:a@b.c">m</a>')).toBe('<a href="mailto:a@b.c">m</a>');
		expect(sanitizeHtml('<a href="tel:+959123456789">t</a>')).toBe('<a href="tel:+959123456789">t</a>');
	});

	it('breaks quote escaping attempts in href', () => {
		expect(sanitizeHtml('<a href="https://x.example/&quot; onclick=&quot;alert(1)">x</a>')).toBe(
			'<a href="https://x.example/&quot; onclick=&quot;alert(1)">x</a>',
		);
		expect(sanitizeHtml('<a href="https://x.example" onmouseover="alert(1)">x</a>')).toBe('<a href="https://x.example">x</a>');
	});

	it('strips comments and unknown tags but keeps their inner text', () => {
		expect(sanitizeHtml('<!-- comment --><p>ok</p>')).toBe('<p>ok</p>');
		expect(sanitizeHtml('<marquee>scroll</marquee>')).toBe('scroll');
		expect(sanitizeHtml('<custom-widget data-x="1">inner</custom-widget>')).toBe('inner');
	});

	it('is deterministic and idempotent (sanitize(sanitize(x)) === sanitize(x))', () => {
		const evil = '<p onclick="x"><script>bad()</script><a href="javascript:y">z</a></p>';
		const once = sanitizeHtml(evil);
		expect(sanitizeHtml(once)).toBe(once);
	});
});

/**
 * Minimal XLSX writer — zero-dependency, workerd-safe.
 *
 * Emits a STORE-only ZIP archive (no compression) containing the minimal Office
 * Open XML parts: workbook, one worksheet (inline strings + numeric cells),
 * styles, and the package rels. Numbers are written as numeric cells so Excel
 * keeps them numeric; everything else becomes an inline string.
 *
 * Chosen over `exceljs`/`xlsx` because those pull Node polyfills that are heavy
 * (and sometimes broken) on the Workers runtime — this writer is ~150 lines and
 * produces a file Excel, LibreOffice and Numbers all open cleanly.
 */

// ─── CRC-32 (IEEE, table-based) ─────────────────────────

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

// ─── XML helpers ────────────────────────────────────────

function xmlEscape(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Spreadsheet column reference: 0 → A, 25 → Z, 26 → AA … */
function colRef(index: number): string {
	let s = '';
	let n = index + 1;
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

function cellXml(ref: string, value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return `<c r="${ref}"><v>${value}</v></c>`;
	}
	const text = value == null ? '' : String(value);
	return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(
	headers: string[],
	rows: Array<Record<string, unknown>>,
	keyOf: (row: Record<string, unknown>, header: string) => unknown,
): string {
	const out: string[] = [
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
	];
	out.push(`<row r="1">${headers.map((h, i) => cellXml(`${colRef(i)}1`, h)).join('')}</row>`);
	rows.forEach((row, ri) => {
		const r = ri + 2;
		out.push(`<row r="${r}">${headers.map((h, i) => cellXml(`${colRef(i)}${r}`, keyOf(row, h))).join('')}</row>`);
	});
	out.push('</sheetData></worksheet>');
	return out.join('');
}

// ─── Static package parts (Excel-compatible minimal set) ─

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ─── ZIP (STORE) writer ─────────────────────────────────

interface ZipPart {
	name: string;
	data: Uint8Array;
}

interface PartInfo {
	name: Uint8Array;
	data: Uint8Array;
	crc: number;
	localOffset: number;
}

function buildZip(parts: ZipPart[]): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const infos: PartInfo[] = parts.map((p) => ({
		name: encoder.encode(p.name),
		data: p.data,
		crc: crc32(p.data),
		localOffset: 0,
	}));

	let offset = 0;
	for (const i of infos) {
		i.localOffset = offset;
		offset += 30 + i.name.length + i.data.length;
	}
	const centralStart = offset;
	const centralSize = infos.reduce((s, i) => s + 46 + i.name.length, 0);
	const out = new Uint8Array(centralStart + centralSize + 22);
	const v = new DataView(out.buffer);

	// Local file headers + data (STORE — sizes equal).
	offset = 0;
	for (const i of infos) {
		v.setUint32(offset, 0x04034b50, true);
		v.setUint16(offset + 4, 20, true);
		v.setUint16(offset + 6, 0, true); // flags
		v.setUint16(offset + 8, 0, true); // method: store
		v.setUint16(offset + 10, 0, true); // mod time
		v.setUint16(offset + 12, 0, true); // mod date
		v.setUint32(offset + 14, i.crc, true);
		v.setUint32(offset + 18, i.data.length, true); // compressed size
		v.setUint32(offset + 22, i.data.length, true); // uncompressed size
		v.setUint16(offset + 26, i.name.length, true);
		v.setUint16(offset + 28, 0, true); // extra len
		out.set(i.name, offset + 30);
		out.set(i.data, offset + 30 + i.name.length);
		offset += 30 + i.name.length + i.data.length;
	}

	// Central directory.
	let cd = centralStart;
	for (const i of infos) {
		v.setUint32(cd, 0x02014b50, true);
		v.setUint16(cd + 4, 20, true); // version made by
		v.setUint16(cd + 6, 20, true); // version needed
		v.setUint16(cd + 8, 0, true); // flags
		v.setUint16(cd + 10, 0, true); // method
		v.setUint16(cd + 12, 0, true); // mod time
		v.setUint16(cd + 14, 0, true); // mod date
		v.setUint32(cd + 16, i.crc, true);
		v.setUint32(cd + 20, i.data.length, true); // compressed size
		v.setUint32(cd + 24, i.data.length, true); // uncompressed size
		v.setUint16(cd + 28, i.name.length, true);
		v.setUint16(cd + 30, 0, true); // extra len
		v.setUint16(cd + 32, 0, true); // comment len
		v.setUint16(cd + 34, 0, true); // disk start
		v.setUint16(cd + 36, 0, true); // internal attrs
		v.setUint32(cd + 38, 0, true); // external attrs
		v.setUint32(cd + 42, i.localOffset, true);
		out.set(i.name, cd + 46);
		cd += 46 + i.name.length;
	}

	// End of central directory.
	v.setUint32(cd, 0x06054b50, true);
	v.setUint16(cd + 4, 0, true); // this disk
	v.setUint16(cd + 6, 0, true); // cd disk
	v.setUint16(cd + 8, infos.length, true); // entries on disk
	v.setUint16(cd + 10, infos.length, true); // entries total
	v.setUint32(cd + 12, centralSize, true);
	v.setUint32(cd + 16, centralStart, true);
	v.setUint16(cd + 20, 0, true); // comment len

	return out;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Build an `.xlsx` workbook (one sheet) from headers + rows.
 * `keyOf` maps each (row, header) pair to its cell value — numbers stay
 * numeric, everything else becomes an inline string.
 */
export function toXlsxBuffer(
	headers: string[],
	rows: Array<Record<string, unknown>>,
	keyOf: (row: Record<string, unknown>, header: string) => unknown,
): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const parts: ZipPart[] = [
		{ name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
		{ name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
		{ name: 'xl/workbook.xml', data: encoder.encode(WORKBOOK_XML) },
		{ name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
		{ name: 'xl/styles.xml', data: encoder.encode(STYLES_XML) },
		{ name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml(headers, rows, keyOf)) },
	];
	return buildZip(parts);
}

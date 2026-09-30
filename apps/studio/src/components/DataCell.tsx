import type { CSSProperties } from 'react';
import type { FieldDefinition } from '../lib/api';
import { renderCell } from '../lib/cell-render';

/** True when `v` is a loadable image reference (R2 `/api/media/…` path or an
 *  http(s) URL) — image-typed values store exactly this. */
function imageSrcOf(f: FieldDefinition, v: unknown): string | null {
	if (f.type !== 'image' || typeof v !== 'string') return null;
	const s = v.trim();
	if (!/^(https?:\/\/|\/api\/media\/)/i.test(s)) return null;
	return s;
}

const IMG_STYLE: CSSProperties = {
	width: 40,
	height: 40,
	borderRadius: 6,
	objectFit: 'cover',
	display: 'block',
	flexShrink: 0,
	background: '#f1f5f9',
	border: '1px solid #e2e8f0',
};

/** A collection-table cell. `image`-typed fields preview a small thumbnail
 *  (R2 asset or external CDN URL) instead of the raw URL text; everything else
 *  keeps the existing ellipsized text rendering. Falls back to the text cell
 *  for empty/broken image values so no column ever breaks.
 *
 *  `displayLeaf` is the related field a RELATION column was set to show — the
 *  thumbnail then reads that field off the related row, like the label does. */
export function DataCell({ field, value, displayLeaf }: { field: FieldDefinition; value: unknown; displayLeaf?: FieldDefinition }) {
	const shownField = displayLeaf ?? field;
	const shownValue =
		displayLeaf && value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)[displayLeaf.name]
			: value;
	const src = imageSrcOf(shownField, shownValue);
	if (src) {
		return (
			<span>
				<img src={src} alt="" style={IMG_STYLE} />
			</span>
		);
	}
	return (
		<span style={{ display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
			{renderCell(field, value, displayLeaf)}
		</span>
	);
}

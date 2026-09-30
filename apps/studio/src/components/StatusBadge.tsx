import { Badge } from '@mmbix/design-system';
import { statusTone, toneVars, type StatusTone } from '../lib/status';

/**
 * The ONE status pill for the Studio. Colour + shape are preattentive markers, so
 * a status must read identically on every screen: this resolves a tone (from
 * `statusTone(status)`, or an explicit `tone`) and paints it with the
 * deployment's `--mmbix-tone-<tone>-*` design tokens — re-themable without a
 * redeploy. Use this instead of a bespoke status→colour map.
 */
export function StatusBadge({
	status,
	tone,
	label,
	className,
}: {
	/** The raw status string (tone is derived from it unless `tone` is given). */
	status?: string | null;
	/** Force a tone instead of deriving one from `status`. */
	tone?: StatusTone;
	/** Text to show; defaults to the raw status. */
	label?: string;
	className?: string;
}) {
	const resolved = tone ?? statusTone(status);
	const text = label ?? status ?? '';
	return (
		<Badge
			variant="outline"
			className={className}
			data-tone={resolved}
			style={{ ...toneVars(resolved), fontWeight: 600, textTransform: 'capitalize' }}
		>
			{text || '—'}
		</Badge>
	);
}

export default StatusBadge;

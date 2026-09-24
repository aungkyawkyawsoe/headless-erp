import { SpinnerGlyph } from './page-spinner';

/**
 * The "loading more" hint — a small spinner plus an optional label, shared by
 * the list paginator (`LoadMoreSentinel`) and the stock module's chunk-reveal
 * list, which had each hand-rolled the same spinner markup.
 */
export function LoadingRow({ label }: { label?: string }) {
	return (
		<>
			<SpinnerGlyph className="size-4" />
			{label ? <span className="text-xs font-medium text-muted-foreground">{label}</span> : null}
		</>
	);
}

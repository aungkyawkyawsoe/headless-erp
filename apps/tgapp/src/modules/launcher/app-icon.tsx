import { SpinnerGlyph } from '@/shared/components/page-spinner';

import type { AppDefinition } from './registry';
import { prefetchApp } from './prefetch';

interface AppTileProps {
	app: AppDefinition;
	onOpen: () => void;
	/** THIS tile's app is opening — dim it and spin, instead of looking idle. */
	busy?: boolean;
	/**
	 * An open is in flight (this tile or another). Every tile goes inert so a
	 * second tap cannot hijack the pending transition — see `open-guard.ts`.
	 */
	locked?: boolean;
}

/** Warm the tile's lazy chunk on touch/mouse intent — see prefetch.ts. */
function warm(app: AppDefinition): () => void {
	// `data: true` — an intent signal (the user is pressing this tile), the only
	// moment warming the destination's DATA is justified.
	return () => prefetchApp(app.id, { data: true });
}

/** The tile's own pressed/opening feedback. */
function tileSurface(busy: boolean | undefined): string {
	return busy ? 'scale-90 opacity-70 shadow-none' : 'transition-transform duration-150 active:scale-90';
}

/** The spinner shown inside a tile while its chunk is still loading. */
function BusySpinner() {
	return (
		<span className="absolute inset-0 grid place-items-center" aria-hidden>
			<SpinnerGlyph className="size-5" tone="inverse" />
		</span>
	);
}

/** Launcher grid tile — gradient rounded-square + white glyph + label. */
export function AppTile({ app, onOpen, busy = false, locked = false }: AppTileProps) {
	const Icon = app.icon;
	return (
		<button
			type="button"
			onClick={onOpen}
			onPointerDown={locked ? undefined : warm(app)}
			onMouseEnter={locked ? undefined : warm(app)}
			disabled={locked}
			aria-busy={busy || undefined}
			data-opening={busy || undefined}
			className="flex flex-col items-center gap-2 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
		>
			<span
				className={`${app.gradient} ${tileSurface(busy)} relative flex size-14 items-center justify-center rounded-2xl bg-linear-to-br text-white shadow-md shadow-black/15`}
			>
				<Icon className={`size-6 ${busy ? 'opacity-0' : ''}`} strokeWidth={2.1} aria-hidden />
				{busy ? <BusySpinner /> : null}
			</span>
			<span className="max-w-23 text-center text-sub font-medium leading-myanmar text-foreground">{app.label}</span>
		</button>
	);
}

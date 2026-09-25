/**
 * Doc No. (naming series) editor — the collection auto-numbering pattern.
 *
 * The SAME dialog is used where collections are curated: the Collections
 * workbench and an app's collection section. Extracted so the pattern preview
 * (prefix + optional `#` counter width) is defined once instead of twice.
 * Behaviour is unchanged.
 */
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '@mmbix/design-system';

export function DocNoDialog({
	open,
	onOpenChange,
	id,
	name,
	value,
	onValueChange,
	example,
	busy,
	onCancel,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Input id — unique per mounting page so each Label binds its own field. */
	id: string;
	/** The collection shown in the description. */
	name: string;
	/** The current pattern (`''` = numbering off). */
	value: string;
	onValueChange: (value: string) => void;
	/** `namingSeriesExample(value)` — the live preview, or null/false. */
	example: string | false | null;
	busy: boolean;
	onCancel: () => void;
	onSave: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent style={{ width: 480 }}>
				<DialogHeader>
					<DialogTitle>Doc No. — auto numbering</DialogTitle>
					<DialogDescription>New records of “{name}” are numbered from this pattern. Leave it empty to turn Doc No. off.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.25rem 0' }}>
					<Label htmlFor={id}>Pattern</Label>
					<Input id={id} autoFocus value={value} onChange={(e) => onValueChange(e.target.value)} placeholder="e.g. OUT- or OUT-####" />
					<div style={{ fontSize: '0.78rem' }}>
						{example === null ? (
							<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Off — new records get no Doc No.</span>
						) : example === false ? (
							<span style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
								Invalid — end with “-”, then up to 10 “#” placeholders (e.g. OUT-#### → OUT-0001).
							</span>
						) : (
							<span>
								First new record → <b>{example}</b>
							</span>
						)}
					</div>
					<div style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
						Only new records get numbered from this pattern — existing rows keep their current Doc No.
					</div>
				</div>
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={onSave} disabled={busy || example === false}>
						{busy ? 'Saving…' : 'Save'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

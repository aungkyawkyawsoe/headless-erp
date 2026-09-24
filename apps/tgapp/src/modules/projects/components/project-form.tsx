import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass, FIELD_LABEL_CLASS as labelClass } from '@/shared/components/form-styles';
import { Check } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { ModuleShell } from '@/shared/components/module-shell';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

/** The values a project form submits — the same shape `createProject` /
 *  `updateProject` accept. */
export interface ProjectFormValues {
	name: string;
	description: string | null;
}

export interface ProjectFormInitial {
	name: string;
	description: string | null;
}

interface ProjectFormProps {
	/** The app-bar title ("New project" / "Edit project"). */
	title: string;
	backTo: string;
	initial?: ProjectFormInitial;
	submitLabel: string;
	/** Persists the values; the caller owns navigation on success. */
	onSave: (values: ProjectFormValues) => Promise<void>;
}

/**
 * The ONE project form behind both the create and the edit screen — name +
 * optional description, with the shared saving/error handling. The create and
 * edit pages differ only in their initial values and what `onSave` does, so the
 * field anatomy lives here once.
 */
export function ProjectForm({ title, backTo, initial, submitLabel, onSave }: ProjectFormProps) {
	const [name, setName] = useState(initial?.name ?? '');
	const [description, setDescription] = useState(initial?.description ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!initial) return;
		setName(initial.name ?? '');
		setDescription(initial.description ?? '');
		setError(null);
	}, [initial]);

	// Dirty gate — an edit must differ from the loaded project before it can save.
	const dirty = useFormDirty({ name: initial?.name ?? '', description: initial?.description ?? '' }, { name, description });

	const canSave = name.trim() !== '' && !saving && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			// On success the caller navigates away, unmounting this form — so
			// `setSaving(false)` deliberately stays in the catch only.
			await onSave({ name: name.trim(), description: description.trim() || null });
		} catch (err) {
			console.error('[projects] save project failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Couldn’t save this project — try again.');
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : submitLabel,
		onClick: () => void submit(),
		disabled: !canSave,
		loading: saving,
	});

	return (
		<ModuleShell title={title} backTo={backTo}>
			<form
				className="flex flex-1 flex-col gap-4 pt-2"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div className="min-w-0">
					<label className={labelClass} htmlFor="project-name">
						Name
					</label>
					<Input
						id="project-name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Website relaunch"
						disabled={saving}
						className={fieldClass}
					/>
				</div>

				<div className="min-w-0">
					<label className={labelClass} htmlFor="project-description">
						Description (optional)
					</label>
					<Textarea
						id="project-description"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						rows={4}
						placeholder="What is this project about?"
						disabled={saving}
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
					/>
				</div>

				<FormError error={error} />

				<FormSubmitBar
					label={submitLabel}
					type="submit"
					isMainButton={isMainButton}
					disabled={!canSave}
					submitting={saving}
					icon={<Check className="size-4" aria-hidden />}
				/>
			</form>
		</ModuleShell>
	);
}

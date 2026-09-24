import { useEffect, useRef, useState } from 'react';
import { Bold, Heading2, Italic, List, ListOrdered, Redo2, Underline, Undo2 } from 'lucide-react';

import { cn } from '@/utils';

interface ToolbarAction {
	icon: typeof Bold;
	label: string;
	command: string;
	arg?: string;
}

const TOOLBAR: ToolbarAction[] = [
	{ icon: Bold, label: 'Bold', command: 'bold' },
	{ icon: Italic, label: 'Italic', command: 'italic' },
	{ icon: Underline, label: 'Underline', command: 'underline' },
	{ icon: Heading2, label: 'Heading', command: 'formatBlock', arg: 'h2' },
	{ icon: List, label: 'Bullet list', command: 'insertUnorderedList' },
	{ icon: ListOrdered, label: 'Numbered list', command: 'insertOrderedList' },
];

/**
 * RichTextEditor — a lightweight WYSIWYG rich-text field for the design system.
 *
 * - Content is HTML (`contentEditable` + `document.execCommand`, zero deps)
 * - Controlled: `value` (HTML) → `onChange`
 * - Toolbar: bold / italic / underline / heading / bullet + numbered lists / undo / redo
 * - `placeholder` shows while the editor is empty
 *
 * Reusable across apps — styled with the same design tokens the host app defines
 * (bg-muted, border-input, text-foreground…), so no external stylesheet needed.
 */
export function RichTextEditor({
	value,
	onChange,
	placeholder,
	disabled,
	className,
	minHeight = 140,
	'aria-invalid': invalid,
}: {
	value: string;
	onChange: (html: string) => void;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	minHeight?: number;
	'aria-invalid'?: boolean;
}) {
	const editorRef = useRef<HTMLDivElement>(null);
	const [isEmpty, setIsEmpty] = useState(!value);

	// Sync external value changes (edit-mode prefill, form reset) — never while typing.
	useEffect(() => {
		const el = editorRef.current;
		if (el && el.innerHTML !== value) el.innerHTML = value || '';
		setIsEmpty(!value || !el?.textContent?.trim());
	}, [value]);

	const emit = () => {
		const html = editorRef.current?.innerHTML ?? '';
		onChange(html);
		setIsEmpty(!editorRef.current?.textContent?.trim());
	};

	const exec = (command: string, arg?: string) => {
		editorRef.current?.focus();
		document.execCommand(command, false, arg);
		emit();
	};

	return (
		<div
			className={cn(
				'overflow-hidden rounded-lg border border-input bg-muted/30 transition-colors',
				'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20',
				invalid && 'border-destructive focus-within:border-destructive focus-within:ring-destructive/20',
				disabled && 'pointer-events-none opacity-60',
				className,
			)}
		>
			{/* Toolbar — its own header band (muted bg + bottom border) so the
			   formatting tools never visually merge with the content area. Icons get
			   full 44×44 touch targets with 8px gaps for safe thumb taps. */}
			<div className="flex flex-wrap items-center gap-2 border-b border-input/70 bg-muted/60 px-1 py-0.5">
				{TOOLBAR.map((action) => (
					<button
						key={action.command}
						type="button"
						aria-label={action.label}
						title={action.label}
						disabled={disabled}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => exec(action.command, action.arg)}
						className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground active:scale-95"
					>
						<action.icon className="size-5" />
					</button>
				))}
				<span className="mx-0.5 h-5 w-px bg-border/80" aria-hidden="true" />
				<button
					type="button"
					aria-label="Undo"
					title="Undo"
					disabled={disabled}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => exec('undo')}
					className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground active:scale-95"
				>
					<Undo2 className="size-5" />
				</button>
				<button
					type="button"
					aria-label="Redo"
					title="Redo"
					disabled={disabled}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => exec('redo')}
					className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground active:scale-95"
				>
					<Redo2 className="size-5" />
				</button>
			</div>

			{/* Editable surface + placeholder — generous top padding so the first
			   line (and placeholder) sits clearly below the toolbar band. */}
			<div className="relative">
				{isEmpty && placeholder && (
					<div className="pointer-events-none absolute inset-x-3.5 top-3 text-sm text-muted-foreground/60">{placeholder}</div>
				)}
				<div
					ref={editorRef}
					contentEditable={!disabled}
					suppressContentEditableWarning
					role="textbox"
					aria-multiline="true"
					aria-label={placeholder ?? 'Rich text'}
					aria-invalid={invalid}
					className="relative z-10 overflow-y-auto px-3.5 py-3 text-sm leading-myanmar outline-none [&_a]:text-primary [&_a]:underline [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-bold [&_h2]:leading-snug [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:leading-relaxed [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:leading-relaxed"
					style={{ minHeight }}
					onInput={emit}
					onBlur={emit}
				/>
			</div>
		</div>
	);
}

export default RichTextEditor;

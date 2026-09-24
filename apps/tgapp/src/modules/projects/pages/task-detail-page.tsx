import { useState, type ReactNode } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, MessageSquare, MoreVertical, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mmbix/design-system/dropdown-menu';
import { Textarea } from '@mmbix/design-system/textarea';

import { AssigneeAvatars } from '../components/assignee-avatars';
import { CommentComposer } from '../components/comment-composer';
import { ConfirmDeleteSheet } from '../components/confirm-delete-sheet';
import { TaskStatusSheet } from '../components/task-status-sheet';
import {
	createComment,
	deleteComment,
	deleteTask,
	fetchCurrentEmployee,
	fetchTask,
	fetchTaskComments,
	updateComment,
	updateTaskState,
} from '../data/api';
import { segmentMentions, survivingMentionIds } from '../data/mentions';
import { TASK_PRIORITY_META, TASK_STATE_META } from '../data/meta';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import type { CommentModel, TaskState } from '../data/types';
import { STALE_MS } from '@/shared/api/invalidation';
import { EmptyState } from '@/shared/components/empty-state';
import { FormError } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { hapticImpact } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { dueUrgency, formatCompactRelativeTime, formatEnglishDateLabel, toMmtDate } from '@/shared/time/myanmar';

/** Two-letter initials fallback for a comment author without a photo. */
function initials(name: string | null): string {
	if (!name) return '?';
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
}

/** One cell of the task's metadata grid (Due date / Created / Assignees). */
function MetaCell({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
	return (
		<div className={`min-w-0 rounded-xl border border-border/60 bg-muted/40 p-2.5 ${className}`}>
			<span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
			<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold leading-myanmar text-foreground">{children}</div>
		</div>
	);
}

interface CommentCardProps {
	comment: CommentModel;
	/** The signed-in employee's id — their OWN comments expose edit/delete. */
	viewerId: string | null;
	/** Persist an edit; the card keeps its draft and surfaces a failure inline. */
	onSave: (comment: CommentModel, content: string) => Promise<void>;
	/** Ask the screen to confirm a soft-delete of this comment. */
	onRequestDelete: (comment: CommentModel) => void;
}

/**
 * ONE comment card on the activity stream — avatar, author (+ role), time, body.
 *
 * A comment the viewer wrote exposes its actions behind a trailing ⋮ menu
 * (Edit / Delete) rather than as two inline glyph buttons: the header stays one
 * clean line, and a destructive action is never a single stray tap away from the
 * timestamp it sits beside. Only the author's own rows have a menu at all.
 *
 * Editing happens IN PLACE (the body becomes a textarea with Save/Cancel) and
 * deletion goes through the screen's confirmation sheet. Editing keeps the
 * recorded `@` tags that survive the new text and drops the ones the author
 * removed, so an untagged name is never left notified.
 */
function CommentCard({ comment, viewerId, onSave, onRequestDelete }: CommentCardProps) {
	// Highlight exactly the runs the comment RECORDED — a bare `@word` stays text.
	const segments = segmentMentions(
		comment.content,
		comment.mentions.map((entry) => entry.token),
	);
	const isOwn = viewerId !== null && comment.authorId === viewerId;

	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(comment.content);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const beginEdit = () => {
		hapticImpact('light');
		setValue(comment.content);
		setError(null);
		setEditing(true);
	};

	const cancelEdit = () => {
		setError(null);
		setValue(comment.content);
		setEditing(false);
	};

	const save = async () => {
		const next = value.trim();
		if (!next || busy) return;
		// A no-op edit just leaves edit mode; no write, no bump of `updated_at`.
		if (next === comment.content.trim()) {
			setEditing(false);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await onSave(comment, next);
			setEditing(false);
		} catch (err) {
			console.error('[projects] comment update failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Couldn’t save this comment — try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<li className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
						{comment.authorPhoto ? (
							<img src={comment.authorPhoto} alt="" className="size-full object-cover" />
						) : (
							initials(comment.authorName)
						)}
					</span>
					<div className="min-w-0">
						<span className="block truncate text-xs font-bold text-foreground">
							{comment.authorName ?? 'Unknown'}
							{isOwn && <span className="ml-1 font-medium text-muted-foreground">· you</span>}
						</span>
						{comment.authorRole && (
							<span className="block truncate text-[10px] font-medium text-muted-foreground">{comment.authorRole}</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{comment.createdAt && <span className="text-[10px] text-muted-foreground">{formatCompactRelativeTime(comment.createdAt)}</span>}
					{/* The author's own actions — collapsed into a ⋮ menu so the header
					 *  stays a single line and delete is never a stray tap away. */}
					{isOwn && !editing && (
						<DropdownMenu>
							<DropdownMenuTrigger
								aria-label="Comment actions"
								className="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
							>
								<MoreVertical className="size-4" aria-hidden />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" sideOffset={4} className="min-w-36">
								<DropdownMenuItem onClick={beginEdit} className="cursor-pointer text-xs leading-myanmar">
									<Pencil className="size-3.5" aria-hidden />
									Edit
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									onClick={() => {
										hapticImpact('light');
										onRequestDelete(comment);
									}}
									className="cursor-pointer text-xs leading-myanmar"
								>
									<Trash2 className="size-3.5" aria-hidden />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>

			{editing ? (
				<div className="flex flex-col gap-2 pl-9">
					<Textarea
						value={value}
						onChange={(event) => setValue(event.target.value)}
						rows={3}
						aria-label="Edit comment"
						disabled={busy}
						className="min-h-0 resize-none text-xs leading-myanmar"
					/>
					{error && <FormError error={error} />}
					<div className="flex justify-end gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={cancelEdit}
							className={`${DENSE_CARD_FRAME} px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-50`}
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={busy || value.trim() === ''}
							onClick={() => void save()}
							className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
						>
							{busy ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>
			) : (
				<p className="whitespace-pre-wrap pl-9 text-xs leading-myanmar text-foreground">
					{segments.map((segment, index) =>
						segment.kind === 'mention' ? (
							<span key={index} className="font-semibold text-primary">
								{segment.value}
							</span>
						) : (
							<span key={index}>{segment.value}</span>
						),
					)}
				</p>
			)}
		</li>
	);
}

/**
 * Projects — ONE task (`/app/projects/task/:id`): the enterprise task view — a
 * header card (status picker, priority, title, the project/due/assignee/created
 * metadata grid, and the next-action + edit + delete toolbar) over the
 * discussion stream, with a pinned comment composer.
 *
 * Everything rendered is real `hrm_tasks` / `hrm_comments` data: the module has
 * no task description, reporter, reactions or attachments, so those reference-UI
 * parts are deliberately absent rather than faked. The author's role subtitle is
 * their `hrm_designations` name and the "Updated …" stamp is `updated_at`.
 */
export default function TaskDetailPage() {
	const navigate = useNavigate();
	const { id = '' } = useParams();

	const taskQuery = useQuery({ queryKey: qk.task(id), queryFn: () => fetchTask(id), enabled: id !== '', staleTime: PROJECTS_STALE_MS });
	const commentsQuery = useQuery({
		queryKey: qk.comments(id),
		queryFn: () => fetchTaskComments(id),
		enabled: id !== '',
		staleTime: PROJECTS_STALE_MS,
	});
	const meQuery = useQuery({ queryKey: qk.me(), queryFn: fetchCurrentEmployee, staleTime: STALE_MS.master });

	const [busy, setBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [statusOpen, setStatusOpen] = useState(false);
	/** The comment queued for soft-delete — owns the confirmation sheet. */
	const [commentToDelete, setCommentToDelete] = useState<CommentModel | null>(null);

	const task = taskQuery.data ?? null;
	const comments = commentsQuery.data ?? [];

	const move = async (next: TaskState) => {
		if (!task || busy) return;
		hapticImpact('light');
		setBusy(true);
		setActionError(null);
		try {
			await updateTaskState(task.id, next);
		} catch (err) {
			console.error('[projects] task state change failed', err);
			setActionError(err instanceof Error && err.message ? err.message : 'Couldn’t update this task — try again.');
		} finally {
			setBusy(false);
		}
	};

	const post = async (content: string, mentions: string[]) => {
		await createComment(id, content, meQuery.data?.id ?? null, mentions);
	};

	/** Persist a comment edit, keeping only the `@` tags that survive the new text. */
	const saveComment = async (comment: CommentModel, content: string) => {
		await updateComment(comment.id, content, survivingMentionIds(content, comment.mentions));
	};

	const stateMeta = task?.state ? TASK_STATE_META[task.state] : null;
	const priorityMeta = task?.priority ? TASK_PRIORITY_META[task.priority] : null;

	// The toolbar's single primary action — the task's natural next transition.
	const primary =
		task?.state === 'in_progress'
			? { label: 'Mark complete', next: 'done' as TaskState, icon: Check }
			: task?.state === 'done'
				? { label: 'Reopen', next: 'todo' as TaskState, icon: RotateCcw }
				: { label: 'Start task', next: 'in_progress' as TaskState, icon: Play };

	const createdLabel = task?.createdAt ? formatEnglishDateLabel(toMmtDate(task.createdAt)) : null;
	// The due cell's urgency tone — a coloured dot + label (overdue / today / soon).
	const urgency = dueUrgency(task?.dueDate, task?.state);
	const URGENCY_META: Record<'overdue' | 'today' | 'soon', { label: string; dotClass: string; textClass: string }> = {
		overdue: { label: 'Overdue', dotClass: 'bg-status-danger', textClass: 'text-status-danger' },
		today: { label: 'Due today', dotClass: 'bg-status-warning', textClass: 'text-status-warning' },
		soon: { label: 'Due soon', dotClass: 'bg-status-info', textClass: 'text-status-info' },
	};

	return (
		<ModuleShell
			title={task?.number ? `${task.number} · Task` : 'Task'}
			backTo={task?.projectId ? `/app/projects/${task.projectId}` : '/app/projects'}
		>
			<div className="flex flex-1 flex-col gap-4 pt-1">
				{taskQuery.isPending ? (
					<ListSkeleton variant="store-request" count={1} />
				) : !task ? (
					<EmptyState title="Task not found" hint="It may have been removed — go back and pick another." />
				) : (
					<>
						{/* 1. TASK HEADER CARD */}
						<section className="flex flex-col gap-3.5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
							<div className="flex items-start justify-between gap-2">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<button
										type="button"
										onClick={() => {
											hapticImpact('light');
											setStatusOpen(true);
										}}
										className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-meta font-bold uppercase tracking-wide ${stateMeta ? stateMeta.chipClass : 'border-border bg-muted/70 text-muted-foreground'}`}
									>
										<span className={`size-2 rounded-full ${stateMeta ? stateMeta.dotClass : 'bg-muted-foreground'}`} />
										{stateMeta ? stateMeta.label : 'No status'}
										<ChevronDown className="size-3 opacity-60" aria-hidden />
									</button>
									{priorityMeta && (
										<span
											className={`shrink-0 rounded-lg border px-2.5 py-1 text-meta font-bold uppercase tracking-wide ${priorityMeta.chipClass}`}
										>
											{priorityMeta.label} priority
										</span>
									)}
									{/* The due-date urgency — a coloured dot + label, only while it bites. */}
									{urgency && (
										<span
											className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-1 text-meta font-bold uppercase tracking-wide ${URGENCY_META[urgency].textClass}`}
										>
											<span className={`size-2 rounded-full ${URGENCY_META[urgency].dotClass}`} />
											{URGENCY_META[urgency].label}
										</span>
									)}
								</div>
								{task.updatedAt && (
									<span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">{formatCompactRelativeTime(task.updatedAt)}</span>
								)}
							</div>

							<h1 className="text-base font-extrabold leading-myanmar text-foreground">{task.name}</h1>

							{/* Metadata grid — Due date + Created side by side, assignees full width. */}
							<div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
								<div className="grid grid-cols-2 gap-2.5">
									<MetaCell label="Due date">
										<span
											className={`size-1.5 shrink-0 rounded-full ${urgency ? URGENCY_META[urgency].dotClass : 'bg-muted-foreground/50'}`}
											aria-hidden
										/>
										<span className="truncate">{task.dueDate ? formatEnglishDateLabel(task.dueDate) : 'No due date'}</span>
									</MetaCell>
									<MetaCell label="Created">
										<span className="truncate">{createdLabel ?? '—'}</span>
									</MetaCell>
								</div>
								<MetaCell label="Assignees">
									<AssigneeAvatars assignees={task.assignees} max={4} size="md" showNames />
								</MetaCell>
							</div>

							{/* Quick action toolbar. */}
							<div className="flex items-center gap-2 border-t border-border/60 pt-3">
								<button
									type="button"
									disabled={busy}
									onClick={() => void move(primary.next)}
									className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
								>
									<primary.icon className="size-3.5" aria-hidden />
									{primary.label}
								</button>
								{/* Secondary task actions — the same ⋮ menu the comment cards use:
								 *  the primary transition keeps the screen, everything else stays one
								 *  deliberate tap deeper so delete is never hit by accident. */}
								<DropdownMenu>
									<DropdownMenuTrigger
										aria-label="Task actions"
										className={`flex size-9 shrink-0 items-center justify-center ${DENSE_CARD_FRAME} text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`}
									>
										<MoreVertical className="size-4" aria-hidden />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={4} className="min-w-36">
										<DropdownMenuItem
											onClick={() => {
												hapticImpact('light');
												navigate(`/app/projects/task/${encodeURIComponent(id)}/edit`);
											}}
											className="cursor-pointer text-xs leading-myanmar"
										>
											<Pencil className="size-3.5" aria-hidden />
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem
											variant="destructive"
											onClick={() => {
												hapticImpact('light');
												setDeleteOpen(true);
											}}
											className="cursor-pointer text-xs leading-myanmar"
										>
											<Trash2 className="size-3.5" aria-hidden />
											Delete task
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							{actionError && <FormError error={actionError} />}
						</section>

						{/* 2. ACTIVITY STREAM */}
						<section className="flex flex-col gap-3">
							<div className="flex items-center gap-2 px-1">
								<h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
									<MessageSquare className="size-3.5" aria-hidden />
									Discussion &amp; Activity
								</h2>
								{comments.length > 0 && (
									<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-extrabold tabular-nums text-muted-foreground">
										{comments.length}
									</span>
								)}
							</div>

							{/* The system anchor — the task's creation moment (real `created_at`). */}
							{task.createdAt && (
								<div className="flex items-center gap-2 px-1">
									<div className="h-px flex-1 bg-border" aria-hidden />
									<span className="shrink-0 rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
										Task created · {formatCompactRelativeTime(task.createdAt)}
									</span>
									<div className="h-px flex-1 bg-border" aria-hidden />
								</div>
							)}

							{commentsQuery.isPending ? (
								<ListSkeleton variant="category" count={2} />
							) : comments.length === 0 ? (
								<p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs leading-myanmar text-muted-foreground">
									No comments yet — start the discussion.
								</p>
							) : (
								<ul className="flex flex-col gap-3">
									{comments.map((comment) => (
										<CommentCard
											key={comment.id}
											comment={comment}
											viewerId={meQuery.data?.id ?? null}
											onSave={saveComment}
											onRequestDelete={setCommentToDelete}
										/>
									))}
								</ul>
							)}
						</section>

						{/* 3. PINNED COMMENT COMPOSER (with `@` mentions) */}
						<CommentComposer onSubmit={post} />
					</>
				)}
			</div>

			<TaskStatusSheet
				open={statusOpen}
				onOpenChange={setStatusOpen}
				value={task?.state ?? null}
				onChange={(next) => {
					setStatusOpen(false);
					void move(next);
				}}
			/>

			<ConfirmDeleteSheet
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title="Delete this task?"
				description="The task and its comment thread will be removed from the board. This can be undone by an administrator."
				confirmLabel="Delete task"
				onConfirm={async () => {
					await deleteTask(id);
					setDeleteOpen(false);
					popBack(navigate, task?.projectId ? `/app/projects/${task.projectId}` : '/app/projects');
				}}
			/>

			<ConfirmDeleteSheet
				open={commentToDelete !== null}
				onOpenChange={(open) => {
					if (!open) setCommentToDelete(null);
				}}
				title="Delete this comment?"
				description={`This comment by ${commentToDelete?.authorName ?? 'you'} will be removed from the thread. This can be undone by an administrator.`}
				confirmLabel="Delete comment"
				onConfirm={async () => {
					if (!commentToDelete) return;
					await deleteComment(commentToDelete.id);
					setCommentToDelete(null);
				}}
			/>
		</ModuleShell>
	);
}

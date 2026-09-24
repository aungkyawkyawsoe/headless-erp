/**
 * Telegram Push — best-effort bot messages to employees.
 *
 * Private 1:1 bot chats use the user's Telegram id as the chat id, so an
 * employee's `hr_employees.tg_id` is all we need — no chat_id capture or
 * /start webhook required.
 *
 * Never throws: a missing token (local dev), a network failure, or a bot
 * error logs and returns `{ ok: false }` so callers keep the durable in-app
 * `hr_notifications` fallback without crashing.
 */

/** Minimal env surface the pusher reads (cast to Record<string, unknown> at call sites). */
export interface TelegramPushEnv {
	TELEGRAM_BOT_TOKEN?: string;
}

export interface TelegramPushResult {
	ok: boolean;
	error?: string;
}

/** Send a plain/HTML message to a user's private DM. */
export async function sendTelegramMessage(env: Record<string, unknown>, tgId: string, text: string): Promise<TelegramPushResult> {
	const token = typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN : '';
	if (!token) {
		// Local dev / tests — the in-app notification is the fallback channel.
		return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
	}
	try {
		const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: tgId,
				text,
				parse_mode: 'HTML',
				disable_web_page_preview: true,
			}),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return { ok: false, error: `telegram ${res.status}: ${body.slice(0, 200)}` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/** Escape user text for `parse_mode: "HTML"` (bot API rejects raw `<`/`&`). */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Per-request env captured by ONE global middleware (`index.ts`). Compiled
 * lifecycle hooks are handed `(doc, db, auth)` — never `c.env` — so a hook that
 * needs the bot token reads it from here. Env bindings are constant for an
 * isolate's lifetime, so a single holder is safe; it mirrors the marketplace
 * chain's `setChainEnv`.
 */
let runtimeEnv: Record<string, unknown> = {};

/** Wire the current request's env into the holder (idempotent, per request). */
export function setTelegramPushEnv(env: Record<string, unknown>): void {
	runtimeEnv = env;
}

/** Best-effort push using the captured runtime env — for hook code paths. */
export function pushTelegram(tgId: string, text: string): Promise<TelegramPushResult> {
	return sendTelegramMessage(runtimeEnv, tgId, text);
}

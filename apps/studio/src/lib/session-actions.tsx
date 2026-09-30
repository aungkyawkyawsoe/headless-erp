/**
 * The session's ACTIONS, provided once at the authed root.
 *
 * "Log out" used to live on the app launcher grid — the surface that was removed
 * in favour of landing straight on the portal — so the action moved up here and
 * every chrome that offers an account menu reads it from the same place: the
 * portal's user menu, Studio Admin's, and the ⌘K palette (the escape hatch on
 * surfaces with NO user menu, e.g. the panel-less API Docs section).
 *
 * Session STATE (token + user) stays in `App.tsx`; this carries only the action,
 * so a surface never has to receive the callback through props.
 */
import { createContext, useContext, type ReactNode } from 'react';

/** End the session: clear queries + UI state + storage, then show the login screen. */
export type Logout = () => void;

/** No-op default so a spec or story can render a surface without the root provider
 *  (the running app always mounts it — see `AppInner`). */
const LogoutContext = createContext<Logout>(() => {});

export function LogoutProvider({ logout, children }: { logout: Logout; children: ReactNode }) {
	return <LogoutContext.Provider value={logout}>{children}</LogoutContext.Provider>;
}

export function useLogout(): Logout {
	return useContext(LogoutContext);
}

import { createQueryClient } from '@mmbix/sdk-react';

/**
 * The app's single TanStack QueryClient.
 *
 * It is shared by BOTH halves of the app:
 *   • React — passed to `<SdkProvider queryClient={queryClient}>`, so every
 *     component's `useQuery`/`useMutation`/`useQueryClient` talks to it;
 *   • non-React — the offline replay scheduler (`useOfflineSync`) calls
 *     `invalidateQueries()` on it after a successful replay, so writes that
 *     landed while offline surface on every mounted view the moment the app is
 *     back online.
 *
 * Reserving it as a module singleton (instead of letting `<SdkProvider>`
 * construct one) is what makes that second half possible.
 */
export const queryClient = createQueryClient();

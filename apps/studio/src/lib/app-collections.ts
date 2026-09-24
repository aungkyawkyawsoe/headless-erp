/**
 * The launcher app → collection footprint, for the Studio's role editor.
 *
 * The mapping itself lives in `@mmbix/types` (`APP_COLLECTIONS`) because the
 * mini app denies the same apps from the same list (`apps/tgapp/src/shared/
 * app-access.ts`) and the two must never drift: the Studio's board AUTO-GRANTS
 * read on an app's collections (`appRequiredCollections` → `roles-tab.saveRole`)
 * while the mini app HIDES an app whose collections are not read-granted. If the
 * two copies disagreed, the Studio would grant one set and the app would demand
 * another. Sharing the module makes that drift impossible.
 *
 * Re-exported here so the role editor keeps importing from its own lib.
 */
export { APP_COLLECTIONS, appRequiredCollections } from '@mmbix/types';

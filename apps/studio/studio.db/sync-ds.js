#!/usr/bin/env node
/**
 * db:sync-ds — re-scan the installed @mmbix/design-system into ds_exports.
 *
 * Run after upgrading the design system so the builder palette stays in sync:
 *   pnpm --filter @mmbix/studio db:sync-ds
 *
 * (Mirrors the plugin's /__studio/sync-ds endpoint for CI/cold builds.)
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as DS from '@mmbix/design-system';

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(here, 'studio.db'));

const names = Object.keys(DS).filter((n) => /^[A-Z]/.test(n));
const isAtom = (n) => /(Button|Badge|Input|Label|Avatar|Checkbox|Switch|Slider|Progress|Rating|Separator|Skeleton|Spinner|Kbd|Tag|Textarea|SearchBox|NativeSelect)$/.test(n);
const isBlock = (n) => /(Card|Table|Alert|Bubble|LinksCard|ChoiceCard|Tabs|Accordion|Empty|Message|Code|Collapsible|Timeline)$/.test(n) && !isAtom(n);
const isModule = (n) => /(DataTable|Kanban|Calendar|DatePicker|Combobox|Signature|TextEditor|File|M2O|Sidebar|AppShell|Breadcrumb|Chart|Carousel|Command|Sheet|Drawer|Dialog|Popover|Tooltip|DropdownMenu|Select|TagsInput|ColorPicker|Checkbox)$/.test(n) && !isAtom(n) && !isBlock(n);

const upsert = db.prepare(`INSERT OR REPLACE INTO ds_exports (export_name, ds_level, category, has_props, is_used)
	VALUES (?, ?, ?, ?, ?)`);
db.exec('BEGIN');
let count = 0;
for (const n of names) {
	const level = isAtom(n) ? 'atom' : isBlock(n) ? 'block' : isModule(n) ? 'module' : null;
	if (!level) continue;
	upsert.run(n, level, 'general', 1, 1);
	count++;
}
db.exec('COMMIT');
db.close();
console.log(`ds_exports synced: ${count} exports from @mmbix/design-system`);

/**
 * Template Registry (v_template)
 *
 * Single source of truth for all template definitions.
 * Edit v_template.json to add/amend/remove templates.
 * No imports needed — just edit the JSON file.
 */
import vTemplate from './v_template.json';

export interface TemplateEntity {
	name: string;
	slug: string;
	description?: string;
	naming_series?: string;
	fields?: Array<{
		name: string;
		type: string;
		label?: string;
		required?: boolean;
		default?: unknown;
		related_collection?: string;
		related_collections?: string[];
		source?: string;
		foreign_key?: string;
	}>;
}

export interface Template {
	name: string;
	description: string;
	entities: TemplateEntity[];
}

const templateMap = new Map<string, Template>();

type VTemplate = { templates: Record<string, Template> };
for (const [key, t] of Object.entries((vTemplate as VTemplate).templates)) {
	templateMap.set(key, t as Template);
}

export function getTemplate(key: string): Template | undefined {
	return templateMap.get(key);
}

export function listTemplates(): Array<{ name: string; label: string; description: string; entities: number }> {
	return [...templateMap.entries()].map(([key, t]) => ({
		name: key,
		label: t.name,
		description: t.description,
		entities: t.entities.length,
	}));
}

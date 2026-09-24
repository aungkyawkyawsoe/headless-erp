export function humanize(type: string): string {
	return type.charAt(0).toUpperCase() + type.replace(/_/g, ' ').slice(1);
}

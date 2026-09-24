import type { ComponentType, CSSProperties, SVGProps } from 'react';
import {
	BadgeCheck,
	Book,
	Briefcase,
	Building,
	Calendar,
	ClipboardList,
	Clock,
	CreditCard,
	Database,
	FileText,
	Folder,
	Globe,
	Heart,
	Home,
	Key,
	Layers,
	Link,
	Mail,
	MapPin,
	Phone,
	Settings,
	Shield,
	Star,
	User,
	Users,
	Wallet,
} from 'lucide-react';
import { LucideGlyph } from './lucide-cdn';

type IconType = ComponentType<{ size?: number | string; className?: string; style?: CSSProperties } & SVGProps<SVGSVGElement>>;

/**
 * Curated Lucide icons available for form-group labels (parent groups AND sub-groups).
 * The stored value is the `name` string — the same registry powers the Studio picker,
 * the Studio canvas and the runtime form, so an icon chosen in the builder renders
 * identically in the frontend (preview == runtime).
 */
export const GROUP_ICONS: Array<{ name: string; label: string; Icon: IconType }> = [
	{ name: 'folder', label: 'Folder', Icon: Folder },
	{ name: 'users', label: 'People', Icon: Users },
	{ name: 'user', label: 'Person', Icon: User },
	{ name: 'briefcase', label: 'Work', Icon: Briefcase },
	{ name: 'building', label: 'Office', Icon: Building },
	{ name: 'home', label: 'Home', Icon: Home },
	{ name: 'map-pin', label: 'Location', Icon: MapPin },
	{ name: 'mail', label: 'Email', Icon: Mail },
	{ name: 'phone', label: 'Phone', Icon: Phone },
	{ name: 'wallet', label: 'Money', Icon: Wallet },
	{ name: 'credit-card', label: 'Payment', Icon: CreditCard },
	{ name: 'calendar', label: 'Calendar', Icon: Calendar },
	{ name: 'clock', label: 'Time', Icon: Clock },
	{ name: 'star', label: 'Rating', Icon: Star },
	{ name: 'settings', label: 'Settings', Icon: Settings },
	{ name: 'shield', label: 'Security', Icon: Shield },
	{ name: 'key', label: 'Access', Icon: Key },
	{ name: 'book', label: 'Documentation', Icon: Book },
	{ name: 'file-text', label: 'Document', Icon: FileText },
	{ name: 'clipboard-list', label: 'Records', Icon: ClipboardList },
	{ name: 'database', label: 'Data', Icon: Database },
	{ name: 'layers', label: 'Layers', Icon: Layers },
	{ name: 'link', label: 'Related', Icon: Link },
	{ name: 'globe', label: 'Global', Icon: Globe },
	{ name: 'heart', label: 'Health', Icon: Heart },
	{ name: 'badge-check', label: 'Verified', Icon: BadgeCheck },
];

/** Look up a group icon component by its stored name. */
export function groupIconOf(name?: string | null): IconType | null {
	if (!name) return null;
	return GROUP_ICONS.find((g) => g.name === name)?.Icon ?? null;
}

/**
 * Render a group icon by its stored name. Uses the bundled curated set;
 * names outside it render a generic glyph (no runtime CDN fetch — the shared
 * LucideGlyph renders a Box fallback), so a name picked in the builder always
 * renders identically in the runtime form.
 */
export function GroupIcon({ name, size = 13, style }: { name?: string | null; size?: number; style?: CSSProperties }) {
	const Icon = groupIconOf(name);
	if (Icon) return <Icon size={size} style={{ flexShrink: 0, ...style }} aria-hidden />;
	if (!name) return null;
	return <LucideGlyph name={name.replace(/^lucide:/, '')} size={size} style={{ flexShrink: 0, ...style }} />;
}

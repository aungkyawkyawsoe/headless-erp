'use client';

import { Languages } from 'lucide-react';
import { useLocale } from '../locale-provider';
import { Button } from '../button';
import { DropdownMenuItem } from '../dropdown-menu';
import { cn } from '@/utils';

export interface LocaleOption {
	/** BCP-47 tag, e.g. `"en-US"` or `"my-MM"`. */
	value: string;
	/** Full language name (in its own script), e.g. `"မြန်မာ"`. */
	label: string;
	/** Compact code shown in the segmented control. Defaults to the first two letters of `value`, uppercased. */
	shortLabel?: string;
}

const DEFAULT_LOCALES: LocaleOption[] = [
	{ value: 'en', label: 'English', shortLabel: 'EN' },
	{ value: 'my', label: 'မြန်မာ', shortLabel: 'MY' },
];

function getShortLabel(option: LocaleOption): string {
	return option.shortLabel ?? option.value.slice(0, 2).toUpperCase();
}

export interface LocaleMenuItemProps {
	/** Label shown next to the languages icon. Defaults to `"Language"`. */
	label?: string;
	/** Available locales. Defaults to English and Burmese. */
	locales?: LocaleOption[];
	/** Called after the locale is changed. Receives the new locale value. */
	onLocaleChange?: (locale: string) => void;
}

/**
 * A language/locale selector rendered as a dropdown menu item, with a
 * segmented control of the available locales. Intended for user menus and
 * similar dropdowns. Requires a `LocaleProvider` ancestor (which persists
 * the choice and sets `document.documentElement.lang`).
 */
export function LocaleMenuItem({ label = 'Language', locales = DEFAULT_LOCALES, onLocaleChange }: LocaleMenuItemProps) {
	const { locale, setLocale } = useLocale();

	return (
		<DropdownMenuItem className="cursor-default focus:bg-transparent!">
			<Languages />
			<span>{label}</span>
			<div className="ml-auto">
				<div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
					{locales.map((option) => {
						const isActive = locale === option.value;
						return (
							<Button
								key={option.value}
								type="button"
								role="radio"
								aria-checked={isActive}
								aria-label={option.label}
								title={option.label}
								variant="ghost"
								size="xs"
								onClick={() => {
									setLocale(option.value);
									onLocaleChange?.(option.value);
								}}
								className={cn(
									'rounded-full px-1.5 text-2xs leading-none',
									isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
								)}
							>
								{getShortLabel(option)}
							</Button>
						);
					})}
				</div>
			</div>
		</DropdownMenuItem>
	);
}

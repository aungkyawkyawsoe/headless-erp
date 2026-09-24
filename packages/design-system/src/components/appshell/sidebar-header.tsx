'use client';

import * as React from 'react';
import { ChevronsUpDown, PanelLeftOpen } from 'lucide-react';

import { SidebarMenuButton, useSidebar } from '../sidebar';
import { ModuleSwitcher, type Module, type ModuleSwitcherProps } from './module-switcher';

export type { Module, ModuleSwitcherProps };

export interface SidebarHeaderProps {
	modules: Module[];
	activeModule: Module;
	onModuleChange: (module: Module) => void;
	/** Whether to enable the global Cmd+K / Ctrl+K shortcut for the module switcher. Defaults to `true`. */
	enableModuleShortcut?: boolean;
	/** Keyboard key for the module switcher shortcut. Defaults to `"k"`. */
	moduleShortcutKey?: string;
	/** Props forwarded to the underlying `ModuleSwitcher`. */
	moduleSwitcherProps?: Omit<ModuleSwitcherProps, 'modules' | 'activeModule' | 'onSelect' | 'open' | 'onClose'>;
}

export function SidebarHeader({
	modules: _modules,
	activeModule,
	onModuleChange,
	enableModuleShortcut = true,
	moduleShortcutKey = 'k',
	moduleSwitcherProps,
}: SidebarHeaderProps) {
	const { state, toggleSidebar } = useSidebar();
	const collapsed = state === 'collapsed';

	const [switcherOpen, setSwitcherOpen] = React.useState(false);

	// Global keyboard shortcut: Cmd+K / Ctrl+K
	React.useEffect(() => {
		if (!enableModuleShortcut) return;

		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === moduleShortcutKey.toLowerCase()) {
				e.preventDefault();
				setSwitcherOpen((prev) => !prev);
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [enableModuleShortcut, moduleShortcutKey]);

	if (collapsed) {
		return (
			<div className="flex items-center justify-start">
				<div
					className="group/menu-button shrink-0 rounded-sm p-0! transition-all duration-200 ease-out hover:bg-sidebar-accent"
					onClick={toggleSidebar}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => e.key === 'Enter' && toggleSidebar()}
				>
					<div
						className="ml-0.5 flex size-7 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground"
						style={
							activeModule.iconBackground || activeModule.iconColor
								? {
										backgroundColor: activeModule.iconBackground,
										color: activeModule.iconColor,
									}
								: undefined
						}
					>
						<span className="relative grid size-5 place-items-center">
							<activeModule.icon
								strokeWidth={1.8}
								className="col-start-1 row-start-1 size-5 transition-all duration-300 ease-out group-hover/menu-button:scale-75 group-hover/menu-button:opacity-0 group-focus-visible/menu-button:scale-75 group-focus-visible/menu-button:opacity-0"
							/>
							<PanelLeftOpen
								strokeWidth={1.5}
								className="col-start-1 row-start-1 size-4 scale-75 opacity-0 transition-all duration-300 ease-out group-hover/menu-button:scale-100 group-hover/menu-button:opacity-100 group-focus-visible/menu-button:scale-100 group-focus-visible/menu-button:opacity-100"
							/>
						</span>
					</div>
				</div>

				<ModuleSwitcher
					{...moduleSwitcherProps}
					modules={_modules}
					activeModule={activeModule}
					onSelect={onModuleChange}
					open={switcherOpen}
					onClose={() => setSwitcherOpen(false)}
				/>
			</div>
		);
	}

	return (
		<>
			<div className="flex items-center justify-between">
				{/* Module picker button — opens full-screen switcher */}
				<SidebarMenuButton
					tooltip={activeModule.name}
					onClick={() => setSwitcherOpen(true)}
					className="flex w-auto! shrink-0! items-center gap-2 px-2"
				>
					<div
						className="-ml-1 flex size-7 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground"
						style={
							activeModule.iconBackground || activeModule.iconColor
								? {
										backgroundColor: activeModule.iconBackground,
										color: activeModule.iconColor,
									}
								: undefined
						}
					>
						<activeModule.icon strokeWidth={1.8} className="size-5!" />
					</div>
					<span className="truncate text-sm leading-6 font-medium">{activeModule.name}</span>
					<ChevronsUpDown strokeWidth={1.5} className="ml-auto size-4 shrink-0 text-sidebar-foreground/50" />
				</SidebarMenuButton>
			</div>

			<ModuleSwitcher
				{...moduleSwitcherProps}
				modules={_modules}
				activeModule={activeModule}
				onSelect={onModuleChange}
				open={switcherOpen}
				onClose={() => setSwitcherOpen(false)}
			/>
		</>
	);
}

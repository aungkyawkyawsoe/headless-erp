import {
	Avatar,
	AvatarFallback,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ThemeMenuItem,
} from '@mmbix/design-system';
import { LogOut } from 'lucide-react';
import { useMemo } from 'react';

function initialsFor(name: string) {
	return name
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('');
}

export default function UserMenu({ user, onLogout }: { user: { email: string; full_name: string }; onLogout: () => void }) {
	// The avatar is a round chip with the user's initials on the teal accent;
	// clicking it opens the account menu with the sign-out action.
	const handle = useMemo(() => (user.full_name?.trim() ? user.full_name : user.email), [user]);
	const initials = initialsFor(handle);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={handle ? `Account menu for ${handle}` : 'Account menu'}
				title={handle || 'Account'}
				className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
			>
				<Avatar size="sm" className="cursor-pointer">
					<AvatarFallback className="bg-primary font-semibold text-primary-foreground">{initials}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={8} className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="px-2 py-1.5">
						<div className="flex flex-col gap-0.5">
							<span className="text-sm font-medium text-foreground">{user.full_name || 'Studio user'}</span>
							<span className="text-xs text-muted-foreground">{user.email}</span>
						</div>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<ThemeMenuItem />
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onClick={onLogout} className="cursor-pointer">
					<LogOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

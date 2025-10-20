<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore, type User } from '../lib/stores/auth.store';

	let user: User | null = $state(null);
	let loading: boolean = $state(true);

	// Subscribe to auth store changes
	$effect(() => {
		const unsubscribe = authStore.subscribe((state) => {
			user = state.user;
			loading = state.loading;
		});

		return unsubscribe;
	});

	const handleLogout = async () => {
		try {
			await authStore.logout();
			goto('/');
		} catch (error) {
			console.error('Logout error:', error);
			goto('/');
		}
	};
</script>

{#if loading}
	<div class="h-9 w-9 rounded-full bg-muted animate-pulse"></div>
{:else if !user}
	<button
		onclick={() => goto('/')}
		class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
	>
		Login
	</button>
{:else}
	<div class="relative">
		<button class="inline-flex items-center justify-center rounded-full h-8 w-8 bg-muted hover:bg-accent transition-colors">
			<div class="relative h-9 w-9 rounded-full">
				<div class="flex h-full w-full items-center justify-center rounded-full bg-muted">
					{user.email?.charAt(0).toUpperCase() || 'U'}
				</div>
			</div>
		</button>
		
		<!-- Dropdown menu - simplified for now -->
		<div class="absolute right-0 mt-2 w-56 rounded-md bg-popover p-1 text-popover-foreground shadow-md">
			<div class="px-2 py-1.5 text-sm">
				<div class="font-medium">{user.username || 'User'}</div>
				<div class="text-muted-foreground text-xs">{user.email}</div>
			</div>
			<hr class="my-1 border-border" />
			<button
				onclick={handleLogout}
				class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground w-full text-left"
			>
				Logout
			</button>
		</div>
	</div>
{/if}
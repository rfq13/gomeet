<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import '../lib/app.css';
	
	let { children } = $props();
	
	// Import components yang akan dimigrasi
	import AppLogo from '../components/AppLogo.svelte';
	import UserNav from '../components/UserNav.svelte';
	
	// Auth context akan diimplementasikan sebagai Svelte store
	import { authStore } from '../lib/stores/auth.store';
	
	onMount(async () => {
		// Initialize auth on app load
		if (browser) {
			await authStore.initialize();
		}
	});
	
	// Check if current route is dashboard
	const isDashboardRoute = $derived(page.url.pathname.startsWith('/dashboard'));
</script>

<svelte:head>
	<title>GoMeet</title>
	<meta name="description" content="Seamless Video Meetings" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="font-body antialiased min-h-screen">
	{#if $authStore.loading}
		<div class="flex items-center justify-center min-h-screen">
			<p>Loading...</p>
		</div>
	{:else}
		{#if isDashboardRoute}
			<!-- Dashboard Layout -->
			<div class="flex min-h-screen w-full flex-col bg-muted/40">
				<header class="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6 z-50">
					<nav class="flex-col gap-6 text-lg font-medium md:flex md:flex-row md:items-center md:gap-5 md:text-sm lg:gap-6 w-full">
						<a href="/dashboard" class="flex items-center gap-2 text-lg font-semibold md:text-base">
							<AppLogo className="h-7 w-7" />
							<span class="sr-only">GoMeet</span>
						</a>
						<div class="flex w-full items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
							<div class="ml-auto flex-1 sm:flex-initial">
								<!-- This could be a create meeting dialog trigger -->
							</div>
							<UserNav />
						</div>
					</nav>
				</header>
				<main class="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
					{@render children()}
				</main>
			</div>
		{:else}
			<!-- Regular Layout -->
			{@render children()}
		{/if}
	{/if}
</div>

<style>
	:global(body) {
		font-family: 'Inter', Arial, Helvetica, sans-serif;
	}
</style>

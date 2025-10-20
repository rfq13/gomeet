<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '../lib/stores/auth.store';
	import { onMount } from 'svelte';
	import AppLogo from '../components/AppLogo.svelte';

	// Form state
	let email = $state('');
	let password = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	let user: any = $state(null);
	let loading: boolean = $state(true);

	// Subscribe to auth store
	$effect(() => {
		const unsubscribe = authStore.subscribe((state) => {
			user = state.user;
			loading = state.loading;
			errorMessage = state.error || '';
		});

		return unsubscribe;
	});

	// Redirect if already logged in
	$effect(() => {
		if (!loading && user) {
			goto('/dashboard');
		}
	});

	// Placeholder images data
	const loginImage = {
		id: 'login-background',
		imageUrl: 'https://picsum.photos/seed/login-background/1920/1080',
		description: 'Login background',
		imageHint: 'office meeting'
	};

	const onSubmit = async () => {
		if (isSubmitting) return;

		isSubmitting = true;
		errorMessage = '';

		try {
			await authStore.login(email, password);
			// Redirect will happen in the effect
		} catch (error) {
			console.error('Login error:', error);
		} finally {
			isSubmitting = false;
		}
	};

	const handleGoogleSignIn = () => {
		alert('Feature coming soon\nGoogle Sign-In is not yet implemented.');
	};
</script>

<svelte:head>
	<title>Login - GoMeet</title>
</svelte:head>

{#if loading || (user)}
	<div class="flex items-center justify-center min-h-screen">
		<p>Loading...</p>
	</div>
{:else}
	<div class="w-full lg:grid lg:min-h-[100vh] lg:grid-cols-2">
		<div class="hidden bg-muted lg:block relative">
			<img
				src={loginImage.imageUrl}
				alt={loginImage.description}
				data-ai-hint={loginImage.imageHint}
				class="w-full h-full object-cover absolute inset-0"
			/>
			<div class="relative z-10 flex flex-col justify-between h-full p-10 bg-black/50 text-white">
				<div class="flex items-center gap-2 text-2xl font-bold">
					<AppLogo className="h-8 w-8 text-primary" />
					GoMeet
				</div>
				<div class="text-lg">
					<blockquote class="space-y-2">
						<p class="font-medium">
							"This platform has revolutionized how our team collaborates. The
							video quality and reliability are second to none."
						</p>
						<footer class="text-sm font-normal text-gray-300">
							Sofia Davis, Project Manager
						</footer>
					</blockquote>
				</div>
			</div>
		</div>
		<div class="flex items-center justify-center py-12 px-4">
			<div class="mx-auto grid w-[350px] gap-6">
				<div class="grid gap-2 text-center">
					<h1 class="text-3xl font-bold">Login</h1>
					<p class="text-balance text-muted-foreground">
						Enter your email below to login to your account
					</p>
				</div>
				
				<form onsubmit={(e) => { e.preventDefault(); onSubmit(); }} class="grid gap-4">
					<div class="grid gap-2">
						<label for="email" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
							Email
						</label>
						<input
							id="email"
							type="email"
							placeholder="m@example.com"
							bind:value={email}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							required
						/>
					</div>
					
					<div class="grid gap-2">
						<div class="flex items-center">
							<label for="password" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
								Password
							</label>
							<button
								type="button"
								class="ml-auto inline-block text-sm underline"
								onclick={() => alert('Forgot password feature coming soon')}
							>
								Forgot your password?
							</button>
						</div>
						<input
							id="password"
							type="password"
							bind:value={password}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							required
						/>
					</div>

					{#if errorMessage}
						<div class="text-sm text-destructive">
							{errorMessage}
						</div>
					{/if}

					<button
						type="submit"
						class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 w-full"
						disabled={isSubmitting}
					>
						{isSubmitting ? 'Logging in...' : 'Login'}
					</button>
					
					<button
						type="button"
						onclick={handleGoogleSignIn}
						class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 w-full"
					>
						Login with Google
					</button>
				</form>
				
				<div class="mt-4 text-center text-sm">
					Don't have an account? 
					<button
						type="button"
						class="underline"
						onclick={() => goto('/signup')}
					>
						Sign up
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

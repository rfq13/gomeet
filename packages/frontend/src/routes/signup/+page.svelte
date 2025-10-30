<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '../../lib/stores/auth.store';
	import { onMount } from 'svelte';
	import AppLogo from '../../components/AppLogo.svelte';

	// Form state
	let username = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let validationErrors = $state({
		username: '',
		email: '',
		password: '',
		confirmPassword: ''
	});

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
	const signupImage = {
		id: 'signup-background',
		imageUrl: 'https://picsum.photos/seed/signup-background/1920/1080',
		description: 'Signup background',
		imageHint: 'team collaboration'
	};

	// Validation functions
	const validateUsername = (value: string): string => {
		if (!value.trim()) return 'Username is required';
		if (value.length < 3) return 'Username must be at least 3 characters';
		if (value.length > 20) return 'Username must be less than 20 characters';
		if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Username can only contain letters, numbers, and underscores';
		return '';
	};

	const validateEmail = (value: string): string => {
		if (!value.trim()) return 'Email is required';
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(value)) return 'Please enter a valid email address';
		return '';
	};

	const validatePassword = (value: string): string => {
		if (!value) return 'Password is required';
		if (value.length < 6) return 'Password must be at least 6 characters';
		if (!/(?=.*[a-z])/.test(value)) return 'Password must contain at least one lowercase letter';
		if (!/(?=.*[A-Z])/.test(value)) return 'Password must contain at least one uppercase letter';
		if (!/(?=.*\d)/.test(value)) return 'Password must contain at least one number';
		return '';
	};

	const validateConfirmPassword = (value: string, password: string): string => {
		if (!value) return 'Please confirm your password';
		if (value !== password) return 'Passwords do not match';
		return '';
	};

	// Real-time validation
	$effect(() => {
		validationErrors.username = validateUsername(username);
	});

	$effect(() => {
		validationErrors.email = validateEmail(email);
	});

	$effect(() => {
		validationErrors.password = validatePassword(password);
		if (confirmPassword) {
			validationErrors.confirmPassword = validateConfirmPassword(confirmPassword, password);
		}
	});

	$effect(() => {
		if (confirmPassword && password) {
			validationErrors.confirmPassword = validateConfirmPassword(confirmPassword, password);
		}
	});

	const isFormValid = (): boolean => {
		return (
			!validationErrors.username &&
			!validationErrors.email &&
			!validationErrors.password &&
			!validationErrors.confirmPassword &&
			!!username.trim() &&
			!!email.trim() &&
			!!password &&
			!!confirmPassword
		);
	};

	const onSubmit = async () => {
		if (isSubmitting || !isFormValid()) return;

		// Final validation before submission
		const usernameError = validateUsername(username);
		const emailError = validateEmail(email);
		const passwordError = validatePassword(password);
		const confirmPasswordError = validateConfirmPassword(confirmPassword, password);

		if (usernameError || emailError || passwordError || confirmPasswordError) {
			validationErrors.username = usernameError;
			validationErrors.email = emailError;
			validationErrors.password = passwordError;
			validationErrors.confirmPassword = confirmPasswordError;
			return;
		}

		isSubmitting = true;
		errorMessage = '';
		successMessage = '';

		try {
			await authStore.register(username, email, password);
			successMessage = 'Registration successful! Redirecting to dashboard...';
			// Redirect will happen in the effect
		} catch (error) {
			console.error('Registration error:', error);
			errorMessage = error instanceof Error ? error.message : 'Registration failed';
		} finally {
			isSubmitting = false;
		}
	};

	const handleGoogleSignUp = () => {
		alert('Feature coming soon\nGoogle Sign-Up is not yet implemented.');
	};
</script>

<svelte:head>
	<title>Sign Up - GoMeet</title>
</svelte:head>

{#if loading || (user)}
	<div class="flex items-center justify-center min-h-screen">
		<p>Loading...</p>
	</div>
{:else}
	<div class="w-full lg:grid lg:min-h-[100vh] lg:grid-cols-2">
		<div class="hidden bg-muted lg:block relative">
			<img
				src={signupImage.imageUrl}
				alt={signupImage.description}
				data-ai-hint={signupImage.imageHint}
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
							"Join thousands of professionals who trust GoMeet for seamless video collaboration
							and productive meetings."
						</p>
						<footer class="text-sm font-normal text-gray-300">
							Alex Chen, Software Engineer
						</footer>
					</blockquote>
				</div>
			</div>
		</div>
		<div class="flex items-center justify-center py-12 px-4">
			<div class="mx-auto grid w-[350px] gap-6">
				<div class="grid gap-2 text-center">
					<h1 class="text-3xl font-bold">Create Account</h1>
					<p class="text-balance text-muted-foreground">
						Enter your information to create your account
					</p>
				</div>
				
				<form onsubmit={(e) => { e.preventDefault(); onSubmit(); }} class="grid gap-4">
					<div class="grid gap-2">
						<label for="username" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
							Username
						</label>
						<input
							id="username"
							type="text"
							placeholder="johndoe"
							bind:value={username}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							required
						/>
						{#if validationErrors.username}
							<div class="text-sm text-destructive">
								{validationErrors.username}
							</div>
						{/if}
					</div>

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
						{#if validationErrors.email}
							<div class="text-sm text-destructive">
								{validationErrors.email}
							</div>
						{/if}
					</div>
					
					<div class="grid gap-2">
						<label for="password" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
							Password
						</label>
						<input
							id="password"
							type="password"
							placeholder="Enter your password"
							bind:value={password}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							required
						/>
						{#if validationErrors.password}
							<div class="text-sm text-destructive">
								{validationErrors.password}
							</div>
						{/if}
					</div>

					<div class="grid gap-2">
						<label for="confirmPassword" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
							Confirm Password
						</label>
						<input
							id="confirmPassword"
							type="password"
							placeholder="Confirm your password"
							bind:value={confirmPassword}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							required
						/>
						{#if validationErrors.confirmPassword}
							<div class="text-sm text-destructive">
								{validationErrors.confirmPassword}
							</div>
						{/if}
					</div>

					{#if successMessage}
						<div class="text-sm text-green-600 bg-green-50 p-3 rounded-md">
							{successMessage}
						</div>
					{/if}

					{#if errorMessage}
						<div class="text-sm text-destructive">
							{errorMessage}
						</div>
					{/if}

					<button
						type="submit"
						class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 w-full"
						disabled={isSubmitting || !isFormValid()}
					>
						{isSubmitting ? 'Creating account...' : 'Create Account'}
					</button>
					
					<button
						type="button"
						onclick={handleGoogleSignUp}
						class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 w-full"
					>
						Sign up with Google
					</button>
				</form>
				
				<div class="mt-4 text-center text-sm">
					Already have an account? 
					<button
						type="button"
						class="underline"
						onclick={() => goto('/')}
					>
						Login
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
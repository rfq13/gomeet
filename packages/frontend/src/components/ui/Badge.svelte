<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

	type $$Props = {
		class?: string;
		children?: Snippet;
		variant?: Variant;
	};

	let { 
		class: className, 
		children, 
		variant = 'default',
		...restProps 
	}: $$Props = $props();

	const variantClasses = {
		default: 'bg-primary text-primary-foreground hover:bg-primary/80',
		secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
		destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
		outline: 'text-foreground'
	};

	const classes = $derived(cn(
		'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
		variantClasses[variant],
		className
	));
</script>

<div class={classes} role="button" tabindex="0" {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>
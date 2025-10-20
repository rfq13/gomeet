<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type $$Props = {
		class?: string;
		children?: Snippet;
	};

	let { class: className, children, ...restProps }: $$Props = $props();

	const classes = $derived(cn(
		'rounded-lg border bg-card text-card-foreground shadow-sm',
		className
	));
</script>

<div class={classes} {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</div>
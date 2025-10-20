<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type $$Props = {
		class?: string;
		children?: Snippet;
		htmlfor?: string;
	};

	let {
		class: className,
		children,
		htmlfor,
		...restProps
	}: $$Props = $props();

	const classes = $derived(cn(
		'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
		className
	));
</script>

<label class={classes} {...restProps} for={htmlfor}>
	{#if children}
		{@render children()}
	{/if}
</label>
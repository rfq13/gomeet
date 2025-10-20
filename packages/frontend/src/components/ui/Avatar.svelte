<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type $$Props = {
		class?: string;
		children?: Snippet;
		src?: string;
		alt?: string;
		fallback?: string;
	};

	let { 
		class: className, 
		children, 
		src, 
		alt = '', 
		fallback = 'U',
		...restProps 
	}: $$Props = $props();

	const classes = $derived(cn(
		'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full',
		className
	));

	let imageLoaded = $state(false);
	let imageError = $state(false);

	function handleImageLoad() {
		imageLoaded = true;
	}

	function handleImageError() {
		imageError = true;
	}
</script>

<div class={classes} {...restProps}>
	{#if src && !imageError}
		<img
			{src}
			{alt}
			class="aspect-square h-full w-full object-cover"
			onload={handleImageLoad}
			onerror={handleImageError}
		/>
	{:else}
		<div class="flex h-full w-full items-center justify-center rounded-full bg-muted">
			<span class="text-sm font-medium text-muted-foreground">
				{fallback}
			</span>
		</div>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</div>
<script lang="ts">
	import { cn } from '$lib/utils';
	import { createEventDispatcher } from 'svelte';
	import type { Snippet } from 'svelte';

	type $$Props = {
		class?: string;
		children?: Snippet;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	};

	let { 
		class: className, 
		children, 
		open = false,
		onOpenChange,
		...restProps 
	}: $$Props = $props();

	const dispatch = createEventDispatcher();

	let isOpen = $state(open);

	$effect(() => {
		isOpen = open;
	});

	function handleOpenChange(value: boolean) {
		isOpen = value;
		onOpenChange?.(value);
		dispatch('openChange', { open: value });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleOpenChange(false);
		}
	}

	const overlayClasses = $derived(cn(
		'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
		className
	));

	const contentClasses = $derived(cn(
		'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg md:w-full',
		className
	));
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<div class="fixed inset-0 z-50">
		<div 
			class={overlayClasses}
			role="button"
			tabindex="0"
			onclick={() => handleOpenChange(false)}
			onkeydown={(e) => e.key === 'Enter' && handleOpenChange(false)}
		/>
		<div 
			class={contentClasses}
			role="dialog"
			aria-modal="true"
			{...restProps}
		>
			{#if children}
				{@render children()}
			{/if}
		</div>
	</div>
{/if}
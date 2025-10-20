<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type $$Props = {
		class?: string;
		children?: Snippet;
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		onchange?: (event: Event) => void;
	};

	let { 
		class: className, 
		children, 
		value = '',
		placeholder = 'Select an option',
		disabled = false,
		onchange,
		...restProps 
	}: $$Props = $props();

	const classes = $derived(cn(
		'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
		className
	));

	function handleChange(event: Event) {
		onchange?.(event);
	}
</script>

<select 
	class={classes} 
	{value} 
	{disabled} 
	onchange={handleChange}
	{...restProps}
>
	<option value="" disabled selected={!value}>{placeholder}</option>
	{#if children}
		{@render children()}
	{/if}
</select>
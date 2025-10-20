<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type $$Props = HTMLInputAttributes & {
		class?: string;
	};

	let className: $$Props['class'] = undefined;
	let { type = 'text', class: classNameProp, ...restProps }: $$Props = $props();

	const classes = $derived(cn(
		'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
		classNameProp
	));
</script>

<input {type} class={classes} {...restProps} on:keydown on:keypress on:keyup on:focus on:blur on:input on:change on:click />
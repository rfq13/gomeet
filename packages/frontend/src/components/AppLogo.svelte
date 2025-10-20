<script lang="ts">
	let {
		className = '',
		width = 24,
		height = 24
	}: {
		className?: string;
		width?: number;
		height?: number;
	} = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	style:width={width + 'px'}
	style:height={height + 'px'}
>
	<rect width="18" height="18" x="3" y="3" rx="2" ry="2" fill="hsl(var(--primary))" stroke="none" />
	<path d="m15 12-4-2.5v5L15 12z" fill="hsl(var(--primary-foreground))" stroke="none"/>
</svg>
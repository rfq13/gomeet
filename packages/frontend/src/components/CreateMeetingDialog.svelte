<script lang="ts">
	interface Props {
		isOpen: boolean;
		onOpenChange: (isOpen: boolean) => void;
	}

	let { isOpen, onOpenChange }: Props = $props();

	let name = $state('');
	let description = $state('');
	let isSubmitting = $state(false);

	const handleSubmit = async () => {
		if (!name.trim()) {
			alert('Meeting name is required');
			return;
		}

		isSubmitting = true;

		try {
			const meetingData = {
				name: name.trim(),
				description: description.trim() || undefined,
				startTime: new Date().toISOString(),
				duration: 60
			};

			// This will be handled by the parent component
			// We'll dispatch a custom event instead
			const event = new CustomEvent('create-meeting', { detail: meetingData });
			dispatchEvent(event);

			// Reset form and close
			name = '';
			description = '';
			onOpenChange(false);
		} catch (error) {
			console.error('Create meeting error:', error);
			alert('Failed to create meeting. Please try again.');
		} finally {
			isSubmitting = false;
		}
	};

	const handleClose = () => {
		if (!isSubmitting) {
			onOpenChange(false);
		}
	};
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center">
		<div class="fixed inset-0 bg-black/50" onclick={handleClose}></div>
		<div class="relative bg-background rounded-lg shadow-lg p-6 w-full max-w-md">
			<h2 class="text-lg font-semibold mb-4">Create New Meeting</h2>
			<p class="text-sm text-muted-foreground mb-4">
				Give your meeting a name to get started. You can invite others later.
			</p>
			
			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="grid gap-4">
				<div>
					<label for="name" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
						Name
					</label>
					<input
						id="name"
						type="text"
						placeholder="Team Sync"
						bind:value={name}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 mt-2"
						required
					/>
				</div>
				
				<div>
					<label for="description" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
						Description (optional)
					</label>
					<textarea
						id="description"
						placeholder="Meeting description"
						bind:value={description}
						class="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 mt-2"
					></textarea>
				</div>
			</form>
			
			<div class="flex justify-end mt-6">
				<button
					type="button"
					onclick={handleClose}
					class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 mr-2"
					disabled={isSubmitting}
				>
					Cancel
				</button>
				<button
					type="submit"
					onclick={handleSubmit}
					class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
					disabled={isSubmitting}
				>
					{isSubmitting ? 'Creating...' : 'Create & Join Meeting'}
				</button>
			</div>
		</div>
	</div>
{/if}
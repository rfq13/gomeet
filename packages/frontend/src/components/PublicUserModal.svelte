<script lang="ts">
	import { apiClient } from '$lib/api-client';
	import type { PublicUserResponse } from '$types';

	let {
		isOpen = $bindable(false),
		onSubmit,
		onCancel,
		defaultName = '',
		loading = $bindable(false)
	} = $props();

	let name = $state(defaultName);
	let error = $state('');

	// Reset form when modal opens
	$effect(() => {
		if (isOpen) {
			name = defaultName;
			error = '';
		}
	});

	async function handleSubmit() {
		if (!name.trim()) {
			error = 'Nama tidak boleh kosong';
			return;
		}

		if (name.trim().length < 2) {
			error = 'Nama minimal 2 karakter';
			return;
		}

		if (name.trim().length > 50) {
			error = 'Nama maksimal 50 karakter';
			return;
		}

		try {
			loading = true;
			error = '';
			await onSubmit(name.trim());
			isOpen = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Terjadi kesalahan';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !loading) {
			handleSubmit();
		}
	}

	function closeModal() {
		if (!loading) {
			if (onCancel) {
				onCancel();
			} else {
				isOpen = false;
			}
		}
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center">
		<!-- Backdrop -->
		<div class="absolute inset-0 bg-black/50" onclick={closeModal}></div>
		
		<!-- Modal -->
		<div class="relative bg-white rounded-lg shadow-lg p-6 m-4 max-w-md w-full">
			<h2 class="text-xl font-semibold mb-4">Masukkan Nama Anda</h2>
			<p class="text-gray-600 mb-6">
				Anda perlu memasukkan nama untuk bergabung dalam meeting sebagai tamu.
			</p>
			
			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="mb-4">
					<label for="name" class="block text-sm font-medium text-gray-700 mb-2">
						Nama
					</label>
					<input
						id="name"
						type="text"
						bind:value={name}
						onkeydown={handleKeydown}
						disabled={loading}
						class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="Masukkan nama Anda"
						autocomplete="name"
						maxlength="50"
						required
					/>
					{#if error}
						<p class="mt-1 text-sm text-red-600">{error}</p>
					{/if}
				</div>
				
				<div class="flex justify-end gap-3">
					<button
						type="button"
						onclick={closeModal}
						disabled={loading}
						class="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Batal
					</button>
					<button
						type="submit"
						disabled={loading || !name.trim()}
						class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if loading}
							<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						{/if}
						Bergabung
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
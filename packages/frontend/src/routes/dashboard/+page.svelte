<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '../../lib/stores/auth.store';
	import { meetingService } from '../../lib/meeting-service';
	import { format } from 'date-fns';
	import { MoreVertical, PlusCircle, Video } from 'lucide-svelte';
	import type { Meeting, CreateMeetingRequest, AuthState, User } from '$types';

	// State
	let meetings: Meeting[] = $state([]);
	let loading: boolean = $state(true);
	let error: string | null = $state(null);
	let isCreateMeetingOpen = $state(false);
	let openMenuId: string | null = $state(null);
	// Track if meetings have been loaded to prevent duplicate calls
	let meetingsLoaded = $state(false);
	
	// Subscribe to auth store using onMount for proper lifecycle
	import { onMount } from 'svelte';
	
	onMount(() => {
		const unsubscribe = authStore.subscribe((state) => {
			if(!state.user){
				goto('/')
			}
			
			// Only load meetings once when user is authenticated and hydrated
			if (state.user && state.isHydrated && !meetingsLoaded) {
				meetingsLoaded = true;
				loadMeetings();
			}
		});

		return unsubscribe;
	});
	
	// Reactive effect to monitor auth store changes
	$effect(() => {
		// Auth store changes are handled by the template reactivity
	});

	async function loadMeetings() {
		try {
			loading = true;
			error = null;

			const response = await meetingService.getMeetings();
			meetings = response.meetings || [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load meetings';
			console.error('Load meetings error:', err);
		} finally {
			loading = false;
		}
	}

	const handleCreateMeeting = async (data: { name: string; description?: string; startTime: string; duration: number }) => {
		try {
			const createRequest: CreateMeetingRequest = {
				name: data.name,
				description: data.description,
				startTime: data.startTime,
				duration: data.duration
			};
			
			const newMeeting = await meetingService.createMeeting(createRequest);
			
			meetings = [newMeeting, ...meetings];
			isCreateMeetingOpen = false;
			
			// Redirect to the new meeting room
			goto(`/meeting/${newMeeting.id}`);
		} catch (err) {
			console.error('Create meeting error:', err);
			alert('Failed to create meeting. Please try again.');
		}
	};

	const handleDeleteMeeting = async (meetingId: string) => {
		if (!confirm('Are you sure you want to delete this meeting?')) {
			return;
		}

		try {
			await meetingService.deleteMeeting(meetingId);
			meetings = meetings.filter(meeting => meeting.id !== meetingId);
			openMenuId = null;
		} catch (err) {
			console.error('Delete meeting error:', err);
			alert('Failed to delete meeting. Please try again.');
		}
	};

	function toggleMenu(meetingId: string) {
		openMenuId = openMenuId === meetingId ? null : meetingId;
	}

	function closeMenu() {
		openMenuId = null;
	}
</script>
<!-- Backdrop to close menus -->
{#if openMenuId}
	<div class="fixed inset-0 z-40" onclick={closeMenu}></div>
{/if}

{#if !$authStore.user}
	<div class="flex items-center justify-center min-h-screen">
		<p>Please login to access dashboard</p>
	</div>
{:else}
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-semibold">Upcoming Meetings</h1>
		<button
			class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2 shadow-md"
			onclick={() => {
				isCreateMeetingOpen = true;
			}}
		>
			<PlusCircle class="mr-2 h-4 w-4" />
			Create Meeting
		</button>
	</div>

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#if loading}
			{#each Array(4) as _}
				<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
					<div class="flex flex-col space-y-1.5 p-6">
						<div class="h-6 w-3/4 bg-muted rounded animate-pulse"></div>
						<div class="h-4 w-1/2 bg-muted rounded animate-pulse"></div>
					</div>
					<div class="p-6 pt-0">
						<div class="flex -space-x-2 overflow-hidden">
							<div class="h-8 w-8 rounded-full bg-muted animate-pulse"></div>
							<div class="h-8 w-8 rounded-full bg-muted animate-pulse"></div>
							<div class="h-8 w-8 rounded-full bg-muted animate-pulse"></div>
						</div>
						<div class="h-4 w-1/4 bg-muted rounded animate-pulse mt-2"></div>
					</div>
					<div class="items-center p-6 pt-0 flex justify-between">
						<div class="h-10 w-32 bg-muted rounded animate-pulse"></div>
						<div class="h-10 w-10 bg-muted rounded animate-pulse"></div>
					</div>
				</div>
			{/each}
		{:else if meetings.length > 0}
			{#each meetings as meeting (meeting.id)}
				{@const meetingDate = new Date(meeting.startTime)}
				<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
					<div class="flex flex-col space-y-1.5 p-6">
						<h3 class="text-2xl font-semibold leading-none tracking-tight">{meeting.title}</h3>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<span>{format(meetingDate, 'PPP')}</span>
							<span>•</span>
							<span>{format(meetingDate, 'p')}</span>
						</div>
					</div>
					<div class="p-6 pt-0">
						{#if meeting.participants && meeting.participants.length > 0}
							<div class="flex -space-x-2 overflow-hidden">
								{#each meeting.participants as participant}
									<div class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted" title={participant.name}>
										<img
											src={`https://picsum.photos/seed/${participant.userId}/100/100`}
											alt={participant.name}
											class="h-full w-full rounded-full object-cover"
											data-ai-hint="person face"
										/>
									</div>
								{/each}
							</div>
							<p class="text-sm text-muted-foreground mt-2">
								{meeting.participants.length} {meeting.participants.length === 1 ? 'participant' : 'participants'}
							</p>
						{:else}
							<p class="text-sm text-muted-foreground">No participants yet.</p>
						{/if}
					</div>
					<div class="items-center p-6 pt-0 flex justify-between">
						<a href={`/meeting/${meeting.id}`} class="no-underline">
							<button class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">
								<Video class="mr-2 h-4 w-4" />
								Start Meeting
							</button>
						</a>
						<div class="relative">
							<button 
								class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 p-0"
								onclick={() => toggleMenu(meeting.id)}
								aria-label="Meeting options"
							>
								<MoreVertical class="h-4 w-4" />
							</button>
							<!-- Dropdown menu -->
							{#if openMenuId === meeting.id}
								<div class="absolute right-0 mt-2 w-48 rounded-md bg-popover p-1 text-popover-foreground shadow-md z-50">
									<button class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground w-full text-left">
										View Details
									</button>
									<button class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground w-full text-left">
										Reschedule
									</button>
									<button
										onclick={() => handleDeleteMeeting(meeting.id)}
										class="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground w-full text-left text-destructive"
									>
										Cancel Meeting
									</button>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{:else if !error}
			<div class="text-center text-muted-foreground col-span-full mt-8">
				<p>No upcoming meetings. Create one to get started!</p>
			</div>
		{/if}
	</div>

	{#if error}
		<div class="text-center text-destructive col-span-full mt-8">
			<p>Error loading meetings: {error}</p>
		</div>
	{/if}

	<!-- Create Meeting Dialog -->
	{#if isCreateMeetingOpen}
		<div class="fixed inset-0 z-50 flex items-center justify-center">
			<div class="fixed inset-0 bg-black/50" onclick={() => isCreateMeetingOpen = false}></div>
			<div class="relative bg-background rounded-lg shadow-lg p-6 w-full max-w-md">
				<h2 class="text-lg font-semibold mb-4">Create New Meeting</h2>
				<p class="text-sm text-muted-foreground mb-4">
					Give your meeting a name to get started. You can invite others later.
				</p>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						const formData = new FormData(e.target as HTMLFormElement);
						handleCreateMeeting({
							name: formData.get('name') as string,
							description: formData.get('description') as string || undefined,
							startTime: new Date().toISOString(),
							duration: 60
						});
					}}
				>
					<div class="grid gap-4">
						<div>
							<label for="name" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
								Name
							</label>
							<input
								id="name"
								name="name"
								type="text"
								placeholder="Team Sync"
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
								name="description"
								placeholder="Meeting description"
								class="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 mt-2"
							></textarea>
						</div>
					</div>
					<div class="flex justify-end mt-4">
						<button
							type="button"
							onclick={() => isCreateMeetingOpen = false}
							class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 mr-2"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
						>
							Create & Join Meeting
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
{/if}
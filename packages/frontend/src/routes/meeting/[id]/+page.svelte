<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { apiClient } from '$lib/api-client';
	import { authStore } from '../../../lib/stores/auth.store';
	import { createWebRTCService, type PeerConnection } from '$lib/webrtc-service';
	import { onMount } from 'svelte';
	import type { Meeting, JoinPayload, LeavePayload } from '$types';
	import { PublicUserModal } from '$components';

	// WebRTC state
	let webrtcService = $state<any>(null);
	let peers = $state<PeerConnection[]>([]);
	let connectionStatus = $state<'disconnected' | 'connecting' | 'connected'>('disconnected');


	// Types
	interface ParticipantAudio {
		[key: string]: number; // participant id -> audio level
	}

	// State
	let user: any = $state(null);
	let meeting = $state<Meeting | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let hasCameraPermission = $state<boolean | null>(null);
	
	// Public user state
	let showPublicUserModal = $state(false);
	let publicSessionId = $state<string | null>(null);
	let publicUserName = $state('');
	let isPublicUser = $state(false);

	// Media state
	let isMicOn = $state(true);
	let isVideoOn = $state(true);
	let localStream = $state<MediaStream | null>(null);
	let remoteStreams = $state<{ [key: string]: MediaStream }>({});
	let participantAudioLevels = $state<ParticipantAudio>({});
	
	let localVideoElement: HTMLVideoElement | undefined;
	let remoteVideoElements: { [key: string]: HTMLVideoElement } = {};
	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let animationFrameId: number | null = null;

	// Get meeting ID from URL params
	let meetingId = $derived(page.params.id as string);

	// Subscribe to auth store
	$effect(() => {
		const unsubscribe = authStore.subscribe((state) => {
			user = state.user;
		});

		return unsubscribe;
	});

	// Load meeting data and initialize WebRTC
	$effect(() => {
		if (meetingId) {
			loadMeeting();
		}
	});

	// Check for public user session when component mounts
	$effect(() => {
		if (!user && meetingId) {
			checkPublicUserSession();
		}
	});

	// Initialize WebRTC when meeting and local stream are ready
	$effect(() => {
		if (meeting && localStream && !webrtcService) {
			initializeWebRTC();
		}
	});

	async function loadMeeting() {
		try {
			loading = true;
			error = null;

			const token = localStorage.getItem('token');
			const headers: HeadersInit = {};
			
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}

			const response = await apiClient.request(
				`/meetings/${meetingId}${token ? '' : '/public'}`,
				{ headers }
			) as any;
			
			meeting = response?.data;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load meeting';
			console.error('Load meeting error:', err);
		} finally {
			loading = false;
		}
	}

	// Public user functions
	async function checkPublicUserSession() {
		try {
			// Check localStorage for public_session_id
			const sessionId = localStorage.getItem('public_session_id');
			if (!sessionId) {
				// Generate new session ID
				const newSessionId = generateSessionId();
				localStorage.setItem('public_session_id', newSessionId);
				publicSessionId = newSessionId;
				showPublicUserModal = true;
				return;
			}

			publicSessionId = sessionId;

			// Try to get existing public user
			const publicUser = await apiClient.getPublicUserBySessionId(sessionId);
			if (publicUser) {
				publicUserName = publicUser.name;
				isPublicUser = true;
				// Join meeting as public user
				await joinMeetingAsPublicUser(sessionId);
			} else {
				// Show modal for new public user
				showPublicUserModal = true;
			}
		} catch (error) {
			console.error('Error checking public user session:', error);
			// Show modal as fallback
			showPublicUserModal = true;
		}
	}

	function generateSessionId(): string {
		return 'pub_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
	}

	async function handlePublicUserSubmit(name: string) {
		try {
			if (!publicSessionId) {
				publicSessionId = generateSessionId();
				localStorage.setItem('public_session_id', publicSessionId);
			}

			// Create public user
			await apiClient.createPublicUser(name, publicSessionId);
			publicUserName = name;
			isPublicUser = true;
			showPublicUserModal = false;

			// Join meeting as public user
			await joinMeetingAsPublicUser(publicSessionId);
		} catch (error) {
			console.error('Error creating public user:', error);
			throw error;
		}
	}

	async function joinMeetingAsPublicUser(sessionId: string) {
		try {
			await apiClient.joinMeetingAsPublicUser(sessionId, meetingId);
			console.log('Public user joined meeting successfully');
		} catch (error) {
			console.error('Error joining meeting as public user:', error);
			throw error;
		}
	}

	async function leaveMeetingAsPublicUser() {
		try {
			if (publicSessionId && isPublicUser) {
				await apiClient.leaveMeetingAsPublicUser(publicSessionId, meetingId);
				console.log('Public user left meeting successfully');
			}
		} catch (error) {
			console.error('Error leaving meeting as public user:', error);
		}
	}


	async function initializeWebRTC() {
		try {
			console.log('[Meeting] Initializing WebRTC service');
			
			const token = localStorage.getItem('accessToken');
			
			webrtcService = createWebRTCService({
				meetingId,
				localStream: localStream!, // Non-null assertion since we check for it above
				token: token || undefined,
				onPeerJoined: (peer: PeerConnection) => {
					console.log('[Meeting] Peer joined:', peer);
					peers = [...peers, peer];
				},
				onPeerLeft: (peerId: string) => {
					console.log('[Meeting] Peer left:', peerId);
					peers = peers.filter(p => p.id !== peerId);
					// Remove remote stream
					if (remoteStreams[peerId]) {
						delete remoteStreams[peerId];
					}
				},
				onRemoteStream: (peerId: string, stream: MediaStream) => {
					console.log('[Meeting] Received remote stream from:', peerId);
					remoteStreams[peerId] = stream;
				},
				onPeerStateChange: (peerId: string, state: RTCPeerConnectionState) => {
					console.log('[Meeting] Peer state changed:', peerId, state);
				},
				onError: (error: Error) => {
					console.error('[Meeting] WebRTC error:', error);
				},
			});

			await webrtcService.connect();
			connectionStatus = 'connected';
			console.log('[Meeting] WebRTC service connected');
		} catch (error) {
			console.error('[Meeting] Failed to initialize WebRTC:', error);
			connectionStatus = 'disconnected';
		}
	}

	async function setupMediaDevices() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user' },
				audio: { 
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true 
				},
			});
			localStream = stream;
			hasCameraPermission = true;
			initAudioAnalyzer(stream);
		} catch (err) {
			console.error('Error accessing media devices:', err);
			hasCameraPermission = false;
		}
	}

	function initAudioAnalyzer(stream: MediaStream) {
		try {
			if (!audioContext) {
				const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
				audioContext = new AudioContextClass();
			}

			// Resume audio context if suspended
			if (audioContext.state === 'suspended') {
				audioContext.resume();
			}

			const audioTracks = stream.getAudioTracks();
			if (audioTracks.length === 0) {
				console.warn('No audio tracks found in stream');
				return;
			}

			const source = audioContext.createMediaStreamSource(stream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);

			detectAudioLevel();
		} catch (err) {
			console.error('Error initializing audio analyzer:', err);
		}
	}

	function detectAudioLevel() {
		if (!analyser) return;

		const dataArray = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(dataArray);

		const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
		participantAudioLevels['local'] = average;

		animationFrameId = requestAnimationFrame(detectAudioLevel);
	}

	const toggleMic = async () => {
		if (localStream) {
			localStream.getAudioTracks().forEach((track) => {
				track.enabled = !track.enabled;
				isMicOn = track.enabled;
			});
			
			// Update WebRTC service
			if (webrtcService) {
				webrtcService.muteAudio(!isMicOn);
			}
		}
	};

	const toggleVideo = async () => {
		if (!localStream) return;

		const videoTracks = localStream.getVideoTracks();
		const videoTrack = videoTracks[0];

		if (videoTrack && videoTrack.readyState === 'live') {
			// Stop the video track completely to release the camera
			videoTrack.stop();
			isVideoOn = false;
			
			// Create a new stream with only audio tracks to completely remove video
			const audioTracks = localStream.getAudioTracks();
			localStream = new MediaStream(audioTracks);
			
			// Clear video element source
			if (localVideoElement) {
				localVideoElement.srcObject = null;
			}
		} else {
			try {
				// Get new video stream
				const newStream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'user' },
				});
				const newVideoTrack = newStream.getVideoTracks()[0];
				
				if (localStream && newVideoTrack) {
					// Add new video track to existing stream
					localStream.addTrack(newVideoTrack);
				} else if (newVideoTrack) {
					// Create new stream if no existing stream
					localStream = newStream;
				}
				
				isVideoOn = true;
			} catch (err) {
				console.error('Error starting video stream:', err);
				hasCameraPermission = false;
			}
		}

		// Update WebRTC service with new stream
		if (webrtcService && localStream) {
			webrtcService.updateLocalStream(localStream);
		}
	};

	const hangUp = async () => {
		// Leave meeting as public user if applicable
		if (isPublicUser) {
			await leaveMeetingAsPublicUser();
		}

		// Cleanup WebRTC service
		if (webrtcService) {
			webrtcService.destroy();
			webrtcService = null;
		}

		// Cleanup audio analyzer
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		if (audioContext && audioContext.state !== 'closed') {
			audioContext.close();
			audioContext = null;
			analyser = null;
		}

		// Cleanup media streams - stop all tracks to release camera and microphone
		if (localStream) {
			localStream.getTracks().forEach((track) => {
				track.stop(); // This physically stops the camera/mic
			});
			localStream = null;
		}

		// Clear video element source
		if (localVideoElement) {
			localVideoElement.srcObject = null;
		}

		// Cleanup remote streams
		Object.values(remoteStreams).forEach((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		});
		remoteStreams = {};
		
		// Cleanup remote video elements
		Object.values(remoteVideoElements).forEach((video) => {
			if (video) {
				video.srcObject = null;
			}
		});
		remoteVideoElements = {};

		goto('/dashboard');
	};

	// Setup media devices when component mounts
	onMount(() => {
		const cleanup = () => {
			// Cleanup audio analyzer
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
			if (audioContext && audioContext.state !== 'closed') {
				audioContext.close();
				audioContext = null;
				analyser = null;
			}

			// Cleanup media streams - stop all tracks to physically release camera and microphone
			if (localStream) {
				localStream.getTracks().forEach((track) => {
					track.stop(); // This physically stops the camera/mic
				});
				localStream = null;
			}

			// Clear video element source
			if (localVideoElement) {
				localVideoElement.srcObject = null;
			}

			// Cleanup remote streams
			Object.values(remoteStreams).forEach((stream) => {
				stream.getTracks().forEach((track) => track.stop());
			});
			remoteStreams = {};
			
			// Cleanup remote video elements
			Object.values(remoteVideoElements).forEach((video) => {
				if (video) {
					video.srcObject = null;
				}
			});
			remoteVideoElements = {};
			
			// Cleanup remote video elements
			Object.values(remoteVideoElements).forEach((video) => {
				if (video) {
					video.srcObject = null;
				}
			});
			remoteVideoElements = {};
		};

		const setup = async () => {
			if (meeting && hasCameraPermission !== false) {
				await setupMediaDevices();
			}
		};

		setup();
		
		// Cleanup function
		return () => {
			// Cleanup WebRTC service
			if (webrtcService) {
				webrtcService.destroy();
				webrtcService = null;
			}
			
			cleanup();
		};
	});

	// Setup media devices when meeting loads
	$effect(() => {
		if (meeting && !loading && hasCameraPermission !== false) {
			setupMediaDevices();
		}
	});

	// Bind local stream to video element
	$effect(() => {
		if (localStream && localVideoElement) {
			localVideoElement.srcObject = localStream;
		}
	});

	// Bind remote streams to video elements
	$effect(() => {
		Object.keys(remoteStreams).forEach(peerId => {
			const videoElement = remoteVideoElements[peerId];
			if (videoElement && remoteStreams[peerId]) {
				videoElement.srcObject = remoteStreams[peerId];
			}
		});
	});

	// Cleanup on unmount - ensures camera is stopped when user leaves the page
	$effect(() => {
		return () => {
			// Cleanup audio analyzer
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
			if (audioContext && audioContext.state !== 'closed') {
				audioContext.close();
				audioContext = null;
				analyser = null;
			}

			// Cleanup media streams - stop all tracks to physically release camera and microphone
			if (localStream) {
				localStream.getTracks().forEach((track) => {
					track.stop(); // This physically stops the camera/mic
				});
				localStream = null;
			}

			// Clear video element source
			if (localVideoElement) {
				localVideoElement.srcObject = null;
			}

			// Cleanup remote streams
			Object.values(remoteStreams).forEach((stream) => {
				stream.getTracks().forEach((track) => track.stop());
			});
			remoteStreams = {};
		};
	});

	// Helper function untuk audio level visualization
	const getAudioLevel = (level: number) => {
		const normalized = Math.min(level / 50, 1);
		if (normalized > 0.3) return 'high';
		if (normalized > 0.15) return 'medium';
		return 'low';
	};
</script>

<svelte:head>
	<title>{meeting?.title || 'Meeting'} - GoMeet</title>
</svelte:head>

{#if loading || !meeting}
	<div class="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden">
		<header class="p-4 flex justify-between items-center bg-card/80 backdrop-blur-sm border-b z-20">
			<div class="h-7 w-48 bg-muted rounded animate-pulse"></div>
			<div class="flex items-center gap-4">
				<div class="h-7 w-24 bg-muted rounded animate-pulse"></div>
				<div class="h-7 w-32 bg-muted rounded animate-pulse"></div>
			</div>
		</header>
		<div class="flex-1 flex relative">
			<main class="flex-1 flex flex-col items-center justify-center p-4">
				<div class="text-center space-y-4">
					<div class="aspect-video w-full h-full bg-muted rounded-lg animate-pulse"></div>
					<p class="text-muted-foreground">Loading meeting...</p>
				</div>
			</main>
		</div>
	</div>
{:else if hasCameraPermission === false}
	<div class="flex flex-col items-center justify-center min-h-screen">
		<div class="rounded-lg border bg-card text-card-foreground shadow-sm p-6 max-w-lg">
			<h3 class="text-lg font-semibold">Camera and Microphone Access Required</h3>
			<p class="text-sm text-muted-foreground mt-2">
				Please allow camera and microphone access in your browser to join the meeting. Then, refresh the page.
			</p>
			<a href="/dashboard">
				<button class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2 mt-4">
					Back to Dashboard
				</button>
			</a>
		</div>
	</div>
{:else}
	<div class="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden">
		<header class="p-4 flex justify-between items-center bg-card/80 backdrop-blur-sm border-b z-20">
			<h1 class="text-xl font-bold">{meeting.title}</h1>
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-2 text-destructive">
					<span class="relative flex h-3 w-3">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
						<span class="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
					</span>
					<span>Live</span>
				</div>
				<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
					{peers.length + 1} Participant{peers.length !== 0 ? 's' : ''}
				</div>
				<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
					<span class="relative flex h-2 w-2 mr-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'} opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}"></span>
					</span>
					{connectionStatus}
				</div>
			</div>
		</header>
		
		<div class="flex-1 flex relative">
			<main class="flex-1 grid grid-cols-1 {peers.length > 0 ? 'lg:grid-cols-2' : ''} gap-4 p-4">
				<!-- Local video with sound indicator -->
				<div class="relative rounded-lg overflow-hidden bg-card flex items-center justify-center group">
					{#if localStream}
						<video
							bind:this={localVideoElement}
							autoplay
							muted
							playsinline
							class="w-full h-full object-cover"
						/>
					{:else}
						<div class="flex items-center justify-center h-full">
							<div class="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted">
								<span class="text-lg font-medium">You</span>
							</div>
						</div>
					{/if}

					<!-- Sound indicator -->
					{#if isMicOn && participantAudioLevels['local']}
						<div class="absolute top-2 right-2 z-10 flex items-center gap-1">
							<div
								class="w-1 h-6 rounded-full transition-all duration-100"
								class:bg-green-500={getAudioLevel(participantAudioLevels['local']) === 'low'}
								class:bg-yellow-500={getAudioLevel(participantAudioLevels['local']) === 'medium'}
								class:bg-red-500={getAudioLevel(participantAudioLevels['local']) === 'high'}
								style="height: {Math.min(20 + (participantAudioLevels['local'] || 0) / 2, 40)}px"
							></div>
							<div
								class="w-1 h-6 rounded-full transition-all duration-100 opacity-60"
								class:bg-green-500={getAudioLevel(participantAudioLevels['local']) === 'low'}
								class:bg-yellow-500={getAudioLevel(participantAudioLevels['local']) === 'medium'}
								class:bg-red-500={getAudioLevel(participantAudioLevels['local']) === 'high'}
								style="height: {Math.min(12 + (participantAudioLevels['local'] || 0) / 4, 35)}px"
							></div>
							<div
								class="w-1 h-6 rounded-full transition-all duration-100 opacity-40"
								class:bg-green-500={getAudioLevel(participantAudioLevels['local']) === 'low'}
								class:bg-yellow-500={getAudioLevel(participantAudioLevels['local']) === 'medium'}
								class:bg-red-500={getAudioLevel(participantAudioLevels['local']) === 'high'}
								style="height: {Math.min(8 + (participantAudioLevels['local'] || 0) / 6, 30)}px"
							></div>
						</div>
					{/if}
					
					<div class="absolute bottom-2 left-2 z-10">
						<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
							{user?.username || user?.email || publicUserName || 'You'}
						</div>
					</div>
				</div>

				<!-- Remote participant videos -->
				{#each peers as peer (peer.id)}
					<div class="relative rounded-lg overflow-hidden bg-card flex items-center justify-center group">
						{#if remoteStreams[peer.id]}
							<video
								autoplay
								playsinline
								class="w-full h-full object-cover"
								bind:this={remoteVideoElements[peer.id]}
							/>
						{:else}
							<div class="flex items-center justify-center h-full">
								<div class="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted">
									<span class="text-lg font-medium">{peer.name}</span>
								</div>
							</div>
						{/if}
						
						<div class="absolute bottom-2 left-2 z-10">
							<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
								{peer.name}
							</div>
						</div>
					</div>
				{/each}
			</main>
		</div>

		<!-- Meeting Controls -->
		<div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
			<div class="flex items-center gap-2 rounded-lg bg-card/80 p-3 backdrop-blur-sm border">
				<button
					onclick={toggleMic}
					class="inline-flex items-center justify-center rounded-full transition-colors {isMicOn ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-destructive text-destructive-foreground hover:bg-destructive/80'} h-12 w-12 p-0"
					aria-label={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
				>
					{#if isMicOn}
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
							<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
							<line x1="12" x2="12" y1="19" y2="22"></line>
						</svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="2" x2="22" y1="2" y2="22"></line>
							<path d="M18.89 13.23A7.12 7.12 0 0 1 12 20c-3.5 0-6.45-2.56-7-5.97"></path>
							<path d="M12 9.04V2.5"></path>
							<path d="M4.93 4.93L7.76 7.76"></path>
						</svg>
					{/if}
				</button>
				
				<button
					onclick={toggleVideo}
					class="inline-flex items-center justify-center rounded-full transition-colors {isVideoOn ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-destructive text-destructive-foreground hover:bg-destructive/80'} h-12 w-12 p-0"
					aria-label={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
				>
					{#if isVideoOn}
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polygon points="23 7 16 12 23 17 23 7"></polygon>
							<rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
						</svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M16 16v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
							<line x1="1" x2="23" y1="1" y2="23"></line>
						</svg>
					{/if}
				</button>
				
				<button
					onclick={hangUp}
					class="inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors h-12 w-12 p-0"
					aria-label="End call"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="m22 2-7 20-4-9-9 4Z"></path>
					</svg>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Public User Modal -->
{#if showPublicUserModal}
	<PublicUserModal
		bind:isOpen={showPublicUserModal}
		defaultName={publicUserName}
		onSubmit={handlePublicUserSubmit}
		onCancel={() => goto('/dashboard')}
	/>
{/if}
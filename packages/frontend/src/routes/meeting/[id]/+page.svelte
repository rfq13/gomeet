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
		[key: string]: number;
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
	let remoteAnalysers: { [key: string]: AnalyserNode } = {};
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

	// Load meeting data
	$effect(() => {
		if (meetingId) {
			loadMeeting();
		}
	});

	// Check for public user session
	$effect(() => {
		if (!user && meetingId) {
			checkPublicUserSession();
		}
	});

	// Initialize WebRTC
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

	async function checkPublicUserSession() {
		try {
			const sessionId = localStorage.getItem('public_session_id');
			if (!sessionId) {
				const newSessionId = generateSessionId();
				localStorage.setItem('public_session_id', newSessionId);
				publicSessionId = newSessionId;
				showPublicUserModal = true;
				return;
			}

			publicSessionId = sessionId;

			const publicUser = await apiClient.getPublicUserBySessionId(sessionId);
			if (publicUser) {
				publicUserName = publicUser.name;
				isPublicUser = true;
				await joinMeetingAsPublicUser(sessionId);
			} else {
				showPublicUserModal = true;
			}
		} catch (error) {
			console.error('Error checking public user session:', error);
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

			await apiClient.createPublicUser(name, publicSessionId);
			publicUserName = name;
			isPublicUser = true;
			showPublicUserModal = false;

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
			
			// FIXED: Add sessionId for public users
			const sessionId = isPublicUser ? publicSessionId : undefined;
			console.log('[Meeting] WebRTC init - isPublicUser:', isPublicUser, 'sessionId:', sessionId);
			
			webrtcService = createWebRTCService({
				meetingId,
				localStream: localStream!,
				token: token || undefined,
				sessionId: sessionId || undefined,
				onPeerJoined: (peer: PeerConnection) => {
					console.log('[Meeting] Peer joined:', peer);
					peers = [...peers, peer];
				},
				onPeerLeft: (peerId: string) => {
					console.log('[Meeting] Peer left:', peerId);
					peers = peers.filter(p => p.id !== peerId);
					if (remoteStreams[peerId]) {
						delete remoteStreams[peerId];
					}
					if (remoteAnalysers[peerId]) {
						delete remoteAnalysers[peerId];
					}
				},
				onRemoteStream: (peerId: string, stream: MediaStream) => {
					console.log('[Meeting] Received remote stream from:', peerId);
					remoteStreams[peerId] = stream;
					initRemoteAudioAnalyzer(peerId, stream);
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

	function initRemoteAudioAnalyzer(peerId: string, stream: MediaStream) {
		try {
			if (!audioContext) {
				const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
				audioContext = new AudioContextClass();
			}

			if (audioContext.state === 'suspended') {
				audioContext.resume();
			}

			const audioTracks = stream.getAudioTracks();
			if (audioTracks.length === 0) {
				console.warn('No audio tracks found in remote stream');
				return;
			}

			const source = audioContext.createMediaStreamSource(stream);
			const remoteAnalyser = audioContext.createAnalyser();
			remoteAnalyser.fftSize = 256;
			source.connect(remoteAnalyser);
			
			remoteAnalysers[peerId] = remoteAnalyser;
		} catch (err) {
			console.error('Error initializing remote audio analyzer:', err);
		}
	}

	function detectAudioLevel() {
		if (!analyser) return;

		const dataArray = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(dataArray);
		const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
		participantAudioLevels['local'] = average;

		// Detect remote audio levels
		Object.keys(remoteAnalysers).forEach(peerId => {
			const remoteAnalyser = remoteAnalysers[peerId];
			if (remoteAnalyser) {
				const remoteDataArray = new Uint8Array(remoteAnalyser.frequencyBinCount);
				remoteAnalyser.getByteFrequencyData(remoteDataArray);
				const remoteAverage = remoteDataArray.reduce((a, b) => a + b) / remoteDataArray.length;
				participantAudioLevels[peerId] = remoteAverage;
			}
		});

		animationFrameId = requestAnimationFrame(detectAudioLevel);
	}

	const toggleMic = async () => {
		if (localStream) {
			localStream.getAudioTracks().forEach((track) => {
				track.enabled = !track.enabled;
				isMicOn = track.enabled;
			});
			
			if (webrtcService) {
				webrtcService.muteAudio(!isMicOn);
			}
		}
	};

	const toggleVideo = async () => {
		if (!localStream) return;

		if (isVideoOn) {
			// Stop video completely
			const videoTracks = localStream.getVideoTracks();
			videoTracks.forEach(track => {
				track.stop();
				localStream?.removeTrack(track);
			});
			
			if (localVideoElement) {
				localVideoElement.srcObject = null;
			}
			
			isVideoOn = false;
		} else {
			// Start video
			try {
				const newStream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'user' },
				});
				const newVideoTrack = newStream.getVideoTracks()[0];
				
				if (localStream && newVideoTrack) {
					localStream.addTrack(newVideoTrack);
				}
				
				isVideoOn = true;
			} catch (err) {
				console.error('Error starting video stream:', err);
				hasCameraPermission = false;
			}
		}

		if (webrtcService && localStream) {
			webrtcService.updateLocalStream(localStream);
		}
	};

	function stopAllMediaTracks() {
		console.log('[Cleanup] Stopping all media tracks');
		
		// Stop local stream tracks
		if (localStream) {
			localStream.getTracks().forEach((track) => {
				console.log('[Cleanup] Stopping track:', track.kind, track.label);
				track.stop();
			});
			localStream = null;
		}

		// Clear video element
		if (localVideoElement) {
			localVideoElement.srcObject = null;
			localVideoElement.pause();
		}

		// Stop remote streams
		Object.values(remoteStreams).forEach((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		});
		remoteStreams = {};

		// Clear remote video elements
		Object.values(remoteVideoElements).forEach((video) => {
			if (video) {
				video.srcObject = null;
				video.pause();
			}
		});
		remoteVideoElements = {};
	}

	function cleanupAudio() {
		console.log('[Cleanup] Cleaning up audio');
		
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		
		if (audioContext && audioContext.state !== 'closed') {
			audioContext.close();
			audioContext = null;
		}
		
		analyser = null;
		remoteAnalysers = {};
	}

	const hangUp = async () => {
		console.log('[HangUp] Starting cleanup');
		
		// Leave meeting as public user
		if (isPublicUser) {
			await leaveMeetingAsPublicUser();
		}

		// Cleanup WebRTC
		if (webrtcService) {
			webrtcService.destroy();
			webrtcService = null;
		}

		// Stop all media tracks
		stopAllMediaTracks();

		// Cleanup audio
		cleanupAudio();

		goto('/dashboard');
	};

	// Setup on mount
	onMount(() => {
		const setup = async () => {
			if (meeting && hasCameraPermission !== false) {
				await setupMediaDevices();
			}
		};

		setup();
		
		// Cleanup on unmount
		return () => {
			console.log('[OnMount Cleanup] Component unmounting');
			
			if (webrtcService) {
				webrtcService.destroy();
				webrtcService = null;
			}
			
			stopAllMediaTracks();
			cleanupAudio();
		};
	});

	// Setup media when meeting loads
	$effect(() => {
		if (meeting && !loading && hasCameraPermission !== false && !localStream) {
			setupMediaDevices();
		}
	});

	// Bind local stream to video element
	$effect(() => {
		if (localStream && localVideoElement && isVideoOn) {
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

	// Cleanup on beforeunload
	if (typeof window !== 'undefined') {
		window.addEventListener('beforeunload', () => {
			console.log('[BeforeUnload] Cleaning up');
			stopAllMediaTracks();
			cleanupAudio();
		});
	}

	// Helper function for audio level visualization
	const getAudioLevel = (level: number) => {
		const normalized = Math.min(level / 50, 1);
		if (normalized > 0.3) return 'high';
		if (normalized > 0.15) return 'medium';
		return 'low';
	};

	const isSpeaking = (level: number) => {
		return level > 15;
	};
</script>

<svelte:head>
	<title>{meeting?.title || 'Meeting'} - GoMeet</title>
</svelte:head>

{#if loading || !meeting}
	<div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
		<header class="p-4 md:p-6 flex justify-between items-center bg-slate-800/50 backdrop-blur-lg border-b border-slate-700">
			<div class="h-8 w-48 bg-slate-700 rounded-lg animate-pulse"></div>
			<div class="flex items-center gap-4">
				<div class="h-8 w-24 bg-slate-700 rounded-lg animate-pulse"></div>
				<div class="h-8 w-32 bg-slate-700 rounded-lg animate-pulse"></div>
			</div>
		</header>
		<div class="flex-1 flex items-center justify-center p-4">
			<div class="text-center space-y-4">
				<div class="w-16 h-16 border-4 border-slate-600 border-t-blue-500 rounded-full animate-spin mx-auto"></div>
				<p class="text-slate-400 text-lg">Loading meeting...</p>
			</div>
		</div>
	</div>
{:else if hasCameraPermission === false}
	<div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
		<div class="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-8 max-w-md w-full">
			<div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
				<svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
				</svg>
			</div>
			<h3 class="text-2xl font-bold text-white text-center mb-4">Camera & Microphone Required</h3>
			<p class="text-slate-400 text-center mb-8">
				Please allow camera and microphone access in your browser to join the meeting. Then, refresh the page.
			</p>
			<a href="/dashboard" class="block">
				<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors">
					Back to Dashboard
				</button>
			</a>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
		<!-- Header -->
		<header class="p-4 md:p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800/50 backdrop-blur-lg border-b border-slate-700 z-20">
			<h1 class="text-xl md:text-2xl font-bold text-white truncate">{meeting.title}</h1>
			<div class="flex flex-wrap items-center gap-3">
				<!-- Live Indicator -->
				<div class="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 rounded-full border border-red-500/30">
					<span class="relative flex h-2.5 w-2.5">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
					</span>
					<span class="text-red-500 font-medium text-sm">Live</span>
				</div>
				
				<!-- Participants Count -->
				<div class="px-3 py-1.5 bg-slate-700/50 rounded-full border border-slate-600">
					<span class="text-sm font-medium">
						{peers.length + 1} Participant{peers.length !== 0 ? 's' : ''}
					</span>
				</div>
				
				<!-- Connection Status -->
				<div class="px-3 py-1.5 bg-slate-700/50 rounded-full border border-slate-600 flex items-center gap-2">
					<span class="relative flex h-2 w-2">
						<span class="animate-ping absolute inline-flex h-full w-full rounded-full {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'} opacity-75"></span>
						<span class="relative inline-flex rounded-full h-2 w-2 {connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}"></span>
					</span>
					<span class="text-sm font-medium capitalize">{connectionStatus}</span>
				</div>
			</div>
		</header>
		
		<!-- Main Video Grid -->
		<div class="flex-1 p-4 md:p-6 overflow-auto">
			<div class="h-full max-w-7xl mx-auto">
				<div class="grid grid-cols-1 {peers.length > 0 ? 'md:grid-cols-2' : ''} {peers.length > 2 ? 'lg:grid-cols-3' : ''} gap-4 auto-rows-fr">
					<!-- Local Video -->
					<div class="relative rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 shadow-xl aspect-video group">
						{#if localStream && isVideoOn}
							<video
								bind:this={localVideoElement}
								autoplay
								muted
								playsinline
								class="w-full h-full object-cover"
							/>
						{:else}
							<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
								<div class="relative flex items-center justify-center">
									<div class="absolute w-32 h-32 bg-blue-500/20 rounded-full animate-pulse"></div>
									<div class="relative w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-3xl font-bold">
										{(user?.username || user?.email || publicUserName || 'You').charAt(0).toUpperCase()}
									</div>
								</div>
							</div>
						{/if}

						<!-- Speaking Indicator -->
						{#if isMicOn && isSpeaking(participantAudioLevels['local'] || 0)}
							<div class="absolute inset-0 border-4 border-green-500 rounded-2xl pointer-events-none animate-pulse"></div>
						{/if}

						<!-- Audio Visualizer -->
						{#if isMicOn && participantAudioLevels['local']}
							<div class="absolute top-4 right-4 flex items-center gap-1 bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-full">
								<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
									<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
									<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
								</svg>
								{#each [0, 1, 2] as i}
									<div
										class="w-1 rounded-full transition-all duration-100"
										class:bg-green-500={getAudioLevel(participantAudioLevels['local']) !== 'low'}
										class:bg-yellow-500={getAudioLevel(participantAudioLevels['local']) === 'medium'}
										class:bg-red-500={getAudioLevel(participantAudioLevels['local']) === 'high'}
										class:bg-slate-600={getAudioLevel(participantAudioLevels['local']) === 'low'}
										style="height: {Math.min(12 + (participantAudioLevels['local'] || 0) / (3 - i * 0.5), 24)}px; opacity: {1 - i * 0.3}"
									></div>
								{/each}
							</div>
						{/if}
						
						<!-- Name Badge -->
						<div class="absolute bottom-4 left-4 px-3 py-1.5 bg-slate-900/80 backdrop-blur-sm rounded-full border border-slate-700">
							<div class="flex items-center gap-2">
								{#if !isMicOn}
									<svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
									</svg>
								{/if}
								<span class="text-sm font-medium">
									{user?.username || user?.email || publicUserName || 'You'} (You)
								</span>
							</div>
						</div>
					</div>

					<!-- Remote Participants -->
					{#each peers as peer (peer.id)}
						<div class="relative rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 shadow-xl aspect-video group">
							{#if remoteStreams[peer.id]}
								<video
									autoplay
									playsinline
									class="w-full h-full object-cover"
									bind:this={remoteVideoElements[peer.id]}
								/>
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
									<div class="relative flex items-center justify-center">
										<div class="absolute w-32 h-32 bg-purple-500/20 rounded-full animate-pulse"></div>
										<div class="relative w-24 h-24 bg-purple-600 rounded-full flex items-center justify-center text-3xl font-bold">
											{peer.name.charAt(0).toUpperCase()}
										</div>
									</div>
								</div>
							{/if}

							<!-- Speaking Indicator -->
							{#if isSpeaking(participantAudioLevels[peer.id] || 0)}
								<div class="absolute inset-0 border-4 border-green-500 rounded-2xl pointer-events-none animate-pulse"></div>
							{/if}

							<!-- Audio Visualizer -->
							{#if participantAudioLevels[peer.id] && participantAudioLevels[peer.id] > 5}
								<div class="absolute top-4 right-4 flex items-center gap-1 bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-full">
									<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
										<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
										<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
									</svg>
									{#each [0, 1, 2] as i}
										<div
											class="w-1 rounded-full transition-all duration-100"
											class:bg-green-500={getAudioLevel(participantAudioLevels[peer.id]) !== 'low'}
											class:bg-yellow-500={getAudioLevel(participantAudioLevels[peer.id]) === 'medium'}
											class:bg-red-500={getAudioLevel(participantAudioLevels[peer.id]) === 'high'}
											class:bg-slate-600={getAudioLevel(participantAudioLevels[peer.id]) === 'low'}
											style="height: {Math.min(12 + (participantAudioLevels[peer.id] || 0) / (3 - i * 0.5), 24)}px; opacity: {1 - i * 0.3}"
										></div>
									{/each}
								</div>
							{/if}
							
							<!-- Name Badge -->
							<div class="absolute bottom-4 left-4 px-3 py-1.5 bg-slate-900/80 backdrop-blur-sm rounded-full border border-slate-700">
								<span class="text-sm font-medium">{peer.name}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Meeting Controls -->
		<div class="p-4 md:p-6 flex justify-center">
			<div class="flex items-center gap-3 md:gap-4 bg-slate-800/80 backdrop-blur-lg p-4 rounded-2xl border border-slate-700 shadow-2xl">
				<!-- Mic Toggle -->
				<button
					onclick={toggleMic}
					class="relative group flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full transition-all duration-200 transform hover:scale-110 active:scale-95 {isMicOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-700'}"
					aria-label={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
				>
					{#if isMicOn}
						<svg class="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
						</svg>
					{:else}
						<svg class="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
						</svg>
					{/if}
					<div class="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-slate-900 px-2 py-1 rounded text-xs">
						{isMicOn ? 'Mute' : 'Unmute'}
					</div>
				</button>
				
				<!-- Video Toggle -->
				<button
					onclick={toggleVideo}
					class="relative group flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full transition-all duration-200 transform hover:scale-110 active:scale-95 {isVideoOn ? 'bg-slate-700 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-700'}"
					aria-label={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
				>
					{#if isVideoOn}
						<svg class="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
						</svg>
					{:else}
						<svg class="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
						</svg>
					{/if}
					<div class="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-slate-900 px-2 py-1 rounded text-xs">
						{isVideoOn ? 'Stop Video' : 'Start Video'}
					</div>
				</button>
				
				<!-- Hang Up -->
				<button
					onclick={hangUp}
					class="relative group flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full bg-red-600 hover:bg-red-700 transition-all duration-200 transform hover:scale-110 active:scale-95"
					aria-label="End call"
				>
					<svg class="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"/>
					</svg>
					<div class="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-slate-900 px-2 py-1 rounded text-xs">
						Leave
					</div>
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
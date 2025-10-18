"use client";

import { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  ScreenShare,
  MessageSquare,
  X,
  Send,
  ScreenShareOff,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuthContext } from "@/contexts/auth-context";
import { useMeeting } from "@/hooks/use-meetings";
import { useChat } from "@/hooks/use-chat";
import { useMeetingParticipants } from "@/hooks/use-meeting-participants";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PublicUserJoinDialog } from "@/components/public-user-join-dialog";
import { ChatPanel } from "@/components/chat-panel";
import { publicUserService } from "@/lib/public-user-service";
import { WebSocketService } from "@/lib/websocket-service";
import { createWebRTCManager } from "@/lib/webrtc-manager";
import { Participant } from "@/types/webrtc";

// WebRTC configuration
const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

const MeetingControls = ({
  isMicOn,
  toggleMic,
  isVideoOn,
  toggleVideo,
  isScreenSharing,
  toggleScreenShare,
  toggleChat,
  hangUp,
}: {
  isMicOn: boolean;
  toggleMic: () => void;
  isVideoOn: boolean;
  toggleVideo: () => Promise<void>;
  isScreenSharing: boolean;
  toggleScreenShare: () => Promise<void>;
  toggleChat: () => void;
  hangUp: () => void;
}) => (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
    <div className="flex items-center gap-2 rounded-lg bg-card/80 p-3 backdrop-blur-sm border">
      <Button
        variant={isMicOn ? "secondary" : "destructive"}
        size="icon"
        onClick={toggleMic}
        className="rounded-full h-12 w-12"
      >
        {isMicOn ? <Mic /> : <MicOff />}
      </Button>
      <Button
        variant={isVideoOn ? "secondary" : "destructive"}
        size="icon"
        onClick={toggleVideo}
        className="rounded-full h-12 w-12"
      >
        {isVideoOn ? <Video /> : <VideoOff />}
      </Button>
      <Button
        variant={isScreenSharing ? "default" : "secondary"}
        size="icon"
        onClick={toggleScreenShare}
        className="rounded-full h-12 w-12"
      >
        {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
      </Button>
      <Button
        variant="secondary"
        size="icon"
        onClick={toggleChat}
        className="rounded-full h-12 w-12"
      >
        <MessageSquare />
      </Button>
      <Button
        onClick={hangUp}
        variant="destructive"
        size="icon"
        className="rounded-full h-12 w-12"
      >
        <Phone />
      </Button>
    </div>
  </div>
);

const VideoPlayer = ({
  stream,
  name,
  isMuted,
  isSpeaking,
  onToggleFullscreen,
  isFullscreen,
}: {
  stream: MediaStream | null;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    } else if (videoRef.current) {
      // Clear the srcObject if the stream is null to remove the old video frame
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden bg-card flex items-center justify-center transition-all duration-300 group",
        isSpeaking && !isFullscreen
          ? "ring-4 ring-accent ring-offset-2 ring-offset-background"
          : ""
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 z-10">
        <Badge variant="secondary">{name}</Badge>
      </div>
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar className="h-16 w-16">
            <AvatarFallback>{name.charAt(0)}</AvatarFallback>
          </Avatar>
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="secondary"
          onClick={onToggleFullscreen}
          className="h-8 w-8 rounded-full"
        >
          {isFullscreen ? (
            <Minimize className="h-4 w-4" />
          ) : (
            <Maximize className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};

export default function MeetingPage() {
  const [isMicOn, setMicOn] = useState(true);
  const [isVideoOn, setVideoOn] = useState(true);
  const [isScreenSharing, setScreenSharing] = useState(false);
  const [isChatOpen, setChatOpen] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<
    boolean | null
  >(null);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [isPublicUser, setIsPublicUser] = useState(false);
  const [hasJoinedMeeting, setHasJoinedMeeting] = useState(false);
  const [prefilledUserName, setPrefilledUserName] = useState<string>("");
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{
    [key: string]: MediaStream;
  }>({});
  const [speakingParticipants, setSpeakingParticipants] = useState<{
    [key: string]: boolean;
  }>({});
  const [fullscreenParticipantId, setFullscreenParticipantId] = useState<
    string | null
  >(null);

  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenShareTrackRef = useRef<MediaStreamTrack | null>(null);

  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});

  // WebSocket and WebRTC refs
  const webSocketServiceRef = useRef<any>(null);
  const webRTCManagerRef = useRef<any>(null);
  const participants = useRef<Map<string, Participant>>(new Map());

  const router = useRouter();
  const params = useParams();
  const { user } = useAuthContext();

  const meetingId = typeof params.id === "string" ? params.id : "";

  const { meeting, loading: isMeetingLoading } = useMeeting(meetingId);

  // Initialize meeting participants hook
  const {
    getParticipantCount,
    getParticipantsWithLocalUser,
    loading: participantsLoading,
  } = useMeetingParticipants(meetingId, user?.id, isPublicUser);

  // Initialize chat hook without WebSocket service initially
  const chat = useChat({
    meetingId,
    userId: user?.id,
    publicUserId: isPublicUser
      ? publicUserService.getOrCreateSessionId()
      : undefined,
  });

  // Check if user is authenticated or needs to join as public user
  useEffect(() => {
    const checkPublicUserSession = async () => {
      console.log({ user });
      if (!isMeetingLoading && meeting) {
        if (!user) {
          // User is not authenticated, check for existing session
          setIsCheckingSession(true);
          setIsPublicUser(true);

          try {
            const sessionId = localStorage.getItem("public_session_id");
            if (sessionId) {
              // Check if session exists in backend
              const existingUser =
                await publicUserService.getPublicUserBySessionId(sessionId);
              if (existingUser) {
                // User found, pre-fill the name and show dialog
                setPrefilledUserName(existingUser.name);
                console.log("Found existing public user:", existingUser);
              } else {
                // Session ID exists but user not found, clear it
                localStorage.removeItem("public_session_id");
                console.log(
                  "Session ID found but user not found, clearing session"
                );
              }
            }
          } catch (error) {
            console.error("Error checking public user session:", error);
          } finally {
            setIsCheckingSession(false);
            setShowJoinDialog(true);
          }
        }
      }
    };

    checkPublicUserSession();
  }, [user, isMeetingLoading, meeting]);

  const handleJoinSuccess = () => {
    // Set hasJoinedMeeting to true before setting up WebRTC
    setHasJoinedMeeting(true);
    // After successful join, setup WebRTC for public user
    setupWebRTCForPublicUser();
  };

  const cleanup = async (isHangup: boolean) => {
    // Cleanup WebRTC manager
    if (webRTCManagerRef.current) {
      webRTCManagerRef.current.cleanup();
      webRTCManagerRef.current = null;
    }

    // Cleanup WebSocket service
    if (webSocketServiceRef.current) {
      webSocketServiceRef.current.disconnect();
      webSocketServiceRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};

    setRemoteStreams({});
    participants.current.clear();

    // Leave meeting via API call only if user has actually joined the meeting
    if (isPublicUser && hasJoinedMeeting) {
      try {
        const sessionId = publicUserService.getOrCreateSessionId();
        await publicUserService.leaveMeetingAsPublicUser({
          sessionId,
          meetingId,
        });
      } catch (error) {
        console.error("Error leaving meeting as public user:", error);
      }
    }

    // Reset hasJoinedMeeting state
    setHasJoinedMeeting(false);

    if (isHangup) {
      router.push("/dashboard");
    }
  };

  const hangUp = () => {
    cleanup(true);
  };

  const setupWebRTCForPublicUser = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      cameraVideoTrackRef.current = stream.getVideoTracks()[0];
      setLocalStream(stream);
      setHasCameraPermission(true);
      // Set hasJoinedMeeting to true after successful WebRTC setup for public user
      setHasJoinedMeeting(true);

      // Setup WebSocket and WebRTC signaling
      await setupWebRTCWithSignaling(stream);
    } catch (error) {
      console.error("Error accessing media devices.", error);
      setHasCameraPermission(false);
    }
  };

  const setupWebRTCWithSignaling = async (stream: MediaStream) => {
    try {
      const participantId = user?.id || "public-user";
      const participantName =
        user?.username || user?.email || (isPublicUser ? "Public User" : "You");

      // Get auth token or session ID
      const token = user ? await getAuthToken() : undefined;
      const sessionId = !user
        ? publicUserService.getOrCreateSessionId()
        : undefined;

      // Create WebSocket service using singleton pattern
      webSocketServiceRef.current = WebSocketService.getInstance({
        url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081",
        meetingId,
        token,
        sessionId,
      });

      // Create WebRTC manager
      webRTCManagerRef.current = createWebRTCManager({
        localStream: stream,
        participantId,
        participantName,
        webSocketService: webSocketServiceRef.current,
        rtcConfig: {
          iceServers: [
            {
              urls: [
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
              ],
            },
          ],
          iceCandidatePoolSize: 10,
        },
      });

      // Setup WebRTC event listeners
      webRTCManagerRef.current.on(
        "participant-joined",
        (participant: Participant) => {
          console.log("Participant joined:", participant);
          participants.current.set(participant.id, participant);
        }
      );

      webRTCManagerRef.current.on(
        "participant-left",
        (participantId: string) => {
          console.log("Participant left:", participantId);
          participants.current.delete(participantId);
          setRemoteStreams((prev) => {
            const newStreams = { ...prev };
            delete newStreams[participantId];
            return newStreams;
          });
        }
      );

      webRTCManagerRef.current.on(
        "remote-stream",
        (participantId: string, remoteStream: MediaStream) => {
          console.log("Received remote stream:", participantId);
          setRemoteStreams((prev) => ({
            ...prev,
            [participantId]: remoteStream,
          }));
        }
      );

      webRTCManagerRef.current.on(
        "connection-state-changed",
        (participantId: string, state: string) => {
          console.log("Connection state changed:", participantId, state);
        }
      );

      webRTCManagerRef.current.on("chat-message", (message: any) => {
        console.log("[DEBUG] WebRTC forwarding chat message:", message);
        // Forward chat messages to chat service if it exists
        if (chat && typeof chat.handleWebSocketMessage === "function") {
          chat.handleWebSocketMessage(message);
        }
      });

      webRTCManagerRef.current.on("error", (error: Error) => {
        console.error("WebRTC error:", error);
      });

      // Initialize WebRTC manager
      await webRTCManagerRef.current.initialize();
    } catch (error) {
      console.error("Error setting up WebRTC signaling:", error);
    }
  };

  const getAuthToken = async (): Promise<string> => {
    // Get token from localStorage or auth context
    // This depends on your auth implementation
    if (typeof window !== "undefined") {
      return localStorage.getItem("token") || "";
    }
    return "";
  };

  // --- Speaking Detection Logic ---
  useEffect(() => {
    const audioContexts: { [key: string]: AudioContext } = {};
    const analysers: { [key: string]: AnalyserNode } = {};
    const animationFrameIds: { [key: string]: number } = {};

    const setupAudioAnalysis = (stream: MediaStream, participantId: string) => {
      if (stream.getAudioTracks().length === 0) return;

      try {
        const audioContext = new AudioContext();
        audioContexts[participantId] = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analysers[participantId] = analyser;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkSpeaking = () => {
          analyser.getByteFrequencyData(dataArray);
          const average =
            dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;

          setSpeakingParticipants((prev) => ({
            ...prev,
            [participantId]: average > 30, // Threshold for speaking
          }));

          animationFrameIds[participantId] =
            requestAnimationFrame(checkSpeaking);
        };
        checkSpeaking();
      } catch (e) {
        console.error("Failed to setup audio analysis", e);
      }
    };

    // Analyze local stream
    if (localStream && (user || isPublicUser)) {
      const participantId = user?.id || "public-user";
      if (!analysers[participantId]) {
        setupAudioAnalysis(localStream, participantId);
      }
    }

    // Analyze remote streams
    Object.entries(remoteStreams).forEach(([id, stream]) => {
      if (!analysers[id]) {
        setupAudioAnalysis(stream, id);
      }
    });

    return () => {
      Object.values(animationFrameIds).forEach((id) =>
        cancelAnimationFrame(id)
      );
      Object.values(audioContexts).forEach((context) => {
        if (context.state !== "closed") {
          context.close();
        }
      });
    };
  }, [localStream, remoteStreams, user, isPublicUser]);

  // --- WebRTC Core Logic ---
  useEffect(() => {
    let isMounted = true;

    const setupWebRTC = async () => {
      if ((!user && !isPublicUser) || !meetingId || !isMounted) return;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraVideoTrackRef.current = stream.getVideoTracks()[0];
        setLocalStream(stream);
        setHasCameraPermission(true);
        // Set hasJoinedMeeting to true after successful WebRTC setup for authenticated user
        setHasJoinedMeeting(true);

        // Setup WebSocket and WebRTC signaling
        await setupWebRTCWithSignaling(stream);
      } catch (error) {
        console.error("Error accessing media devices.", error);
        setHasCameraPermission(false);
        return;
      }
    };

    if ((user || isPublicUser) && meetingId && !showJoinDialog) {
      setupWebRTC();
    }

    // Cleanup
    return () => {
      isMounted = false;
      cleanup(false);
    };
  }, [user, isPublicUser, meetingId, showJoinDialog]);

  // LEAVE MEETING HANDLING - Handle browser close scenario
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isPublicUser && hasJoinedMeeting) {
        console.log(
          "[DEBUG] Browser closing, sending synchronous leave request"
        );

        // Send synchronous leave request using navigator.sendBeacon
        const leaveData = JSON.stringify({
          sessionId: publicUserService.getOrCreateSessionId(),
          meetingId: meetingId,
        });

        try {
          navigator.sendBeacon("/api/v1/public-users/leave-meeting", leaveData);
          console.log("[DEBUG] Synchronous leave request sent successfully");
        } catch (error) {
          console.error(
            "[ERROR] Failed to send synchronous leave request:",
            error
          );
        }

        // Also show confirmation dialog (optional, can be removed for better UX)
        const message = "Anda yakin ingin keluar dari meeting?";
        event.returnValue = message; // Standard for most browsers
        return message; // For some browsers
      }
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (isPublicUser && hasJoinedMeeting) {
        console.log("[DEBUG] Page hiding, sending leave request");
        const leaveData = JSON.stringify({
          sessionId: publicUserService.getOrCreateSessionId(),
          meetingId: meetingId,
        });

        try {
          navigator.sendBeacon("/api/v1/public-users/leave-meeting", leaveData);
        } catch (error) {
          console.error(
            "[ERROR] Failed to send leave request on page hide:",
            error
          );
        }
      }
    };

    // Add event listeners for browser close and navigation
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isPublicUser, hasJoinedMeeting, meetingId]);

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        setMicOn(track.enabled);
      });
    }
  };

  const toggleVideo = async () => {
    if (!localStream) return;

    // Cannot toggle video while screen sharing
    if (isScreenSharing) {
      await toggleScreenShare(); // This will switch back to camera if available
      return;
    }

    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack && videoTrack.readyState === "live") {
      videoTrack.stop();
      setVideoOn(false);
      // The track is removed from the stream implicitly when stopped.
      // Re-create the stream for the state update to ensure UI reflects the avatar state
      setLocalStream(new MediaStream(localStream.getAudioTracks()));
    } else {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        cameraVideoTrackRef.current = newVideoTrack;
        localStream.addTrack(newVideoTrack);

        // Replace the track for all peer connections
        for (const pc of Object.values(peerConnections.current)) {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          } else {
            pc.addTrack(newVideoTrack, localStream);
          }
        }

        // Also replace tracks in WebRTC manager participants
        participants.current.forEach((participant) => {
          if (participant.peerConnection) {
            const sender = participant.peerConnection
              .getSenders()
              .find((s) => s.track?.kind === "video");
            if (sender) {
              sender.replaceTrack(newVideoTrack);
            } else {
              participant.peerConnection.addTrack(newVideoTrack, localStream);
            }
          }
        });

        setVideoOn(true);
        // Force a re-render of local stream to show video
        setLocalStream(new MediaStream(localStream.getTracks()));
      } catch (error) {
        console.error("Error starting video stream:", error);
        setHasCameraPermission(false); // Show permission error UI
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!localStream) return;

    if (isScreenSharing) {
      // Stop screen sharing
      const screenTrack = screenShareTrackRef.current;
      const cameraTrack = cameraVideoTrackRef.current;

      // Ensure we have a camera track to switch back to
      if (cameraTrack && cameraTrack.readyState === "live") {
        // Replace screen track with camera track for all peers
        for (const pc of Object.values(peerConnections.current)) {
          const sender = pc.getSenders().find((s) => s.track === screenTrack);
          if (sender) {
            await sender.replaceTrack(cameraTrack);
          }
        }

        // Also replace tracks in WebRTC manager participants
        participants.current.forEach((participant) => {
          if (participant.peerConnection) {
            const sender = participant.peerConnection
              .getSenders()
              .find((s) => s.track === screenTrack);
            if (sender && cameraTrack) {
              sender.replaceTrack(cameraTrack);
            }
          }
        });
        // Update local stream: remove screen, add camera
        if (screenTrack) localStream.removeTrack(screenTrack);
        localStream.addTrack(cameraTrack);

        setVideoOn(true); // Video is now the camera
      } else {
        // No camera track to switch to, so just stop screen share
        for (const pc of Object.values(peerConnections.current)) {
          const sender = pc.getSenders().find((s) => s.track === screenTrack);
          if (sender) {
            pc.removeTrack(sender);
          }
        }

        // Also remove tracks from WebRTC manager participants
        participants.current.forEach((participant) => {
          if (participant.peerConnection && screenTrack) {
            const sender = participant.peerConnection
              .getSenders()
              .find((s) => s.track === screenTrack);
            if (sender) {
              participant.peerConnection.removeTrack(sender);
            }
          }
        });
        if (screenTrack) localStream.removeTrack(screenTrack);
        setVideoOn(false); // No video source is active
      }

      if (screenTrack) {
        screenTrack.stop();
      }

      screenShareTrackRef.current = null;
      setScreenSharing(false);
      setLocalStream(new MediaStream(localStream.getTracks()));
    } else {
      // Start screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const newScreenTrack = screenStream.getVideoTracks()[0];
        const currentVideoTrack = localStream.getVideoTracks()[0];

        // If there's a camera track, save it
        if (currentVideoTrack) {
          cameraVideoTrackRef.current = currentVideoTrack;
        }

        screenShareTrackRef.current = newScreenTrack;

        // Replace video track with screen track for all peers
        for (const pc of Object.values(peerConnections.current)) {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            await sender.replaceTrack(newScreenTrack);
          } else {
            pc.addTrack(newScreenTrack, localStream);
          }
        }

        // Also replace tracks in WebRTC manager participants
        participants.current.forEach((participant) => {
          if (participant.peerConnection) {
            const sender = participant.peerConnection
              .getSenders()
              .find((s) => s.track?.kind === "video");
            if (sender) {
              sender.replaceTrack(newScreenTrack);
            } else {
              participant.peerConnection.addTrack(newScreenTrack, localStream);
            }
          }
        });

        // Update local stream: remove camera (if exists), add screen
        if (currentVideoTrack) {
          localStream.removeTrack(currentVideoTrack);
        }
        localStream.addTrack(newScreenTrack);

        setLocalStream(new MediaStream(localStream.getTracks()));
        setScreenSharing(true);
        setVideoOn(true); // Screen sharing is a form of video

        // When user clicks "Stop sharing" in browser UI
        newScreenTrack.onended = () => {
          if (screenShareTrackRef.current === newScreenTrack) {
            toggleScreenShare();
          }
        };
      } catch (error) {
        console.error("Error starting screen share:", error);
        if (error instanceof Error && error.name === "NotAllowedError") {
          // This is expected if user cancels. No need to show error UI.
        }
        setScreenSharing(false);
      }
    }
  };

  if (
    isMeetingLoading ||
    !meeting ||
    isCheckingSession ||
    participantsLoading
  ) {
    return (
      <div className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden">
        <header className="p-4 flex justify-between items-center bg-card/80 backdrop-blur-sm border-b z-20">
          <Skeleton className="h-7 w-48" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        </header>
        <div className="flex-1 flex relative">
          <main className="flex-1 flex flex-col items-center justify-center p-4">
            <div className="text-center space-y-4">
              <Skeleton className="aspect-video w-full h-full rounded-lg" />
              {isCheckingSession && (
                <div className="text-muted-foreground">
                  Memeriksa sesi yang ada...
                </div>
              )}
            </div>
          </main>
          <aside className="w-64 bg-card/50 p-2 space-y-2 overflow-y-auto">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="aspect-video w-full rounded-lg" />
          </aside>
        </div>
      </div>
    );
  }

  if (hasCameraPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>Camera and Microphone Access Required</AlertTitle>
          <AlertDescription>
            Please allow camera and microphone access in your browser to join
            the meeting. Then, refresh the page.
          </AlertDescription>
        </Alert>
        <Link href="/dashboard" className="mt-4">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const allStreams = {
    ...(user || isPublicUser
      ? { [user?.id || "public-user"]: localStream }
      : {}),
    ...remoteStreams,
  };

  // Build participants list using meeting participants hook
  const allParticipants = getParticipantsWithLocalUser(
    user?.username || user?.email || (isPublicUser ? "Public User" : "You")
  );

  const mainParticipantId =
    fullscreenParticipantId || user?.id || "public-user";
  const otherParticipantIds = Object.keys(allStreams).filter(
    (id) => id !== mainParticipantId
  );

  const handleToggleFullscreen = (participantId: string) => {
    setFullscreenParticipantId((currentId) =>
      currentId === participantId ? null : participantId
    );
  };

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden">
      <header className="p-4 flex justify-between items-center bg-card/80 backdrop-blur-sm border-b z-20">
        <h1 className="text-xl font-bold">{meeting.title}</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-destructive">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
            </span>
            <span>Live</span>
          </div>
          <Badge variant="secondary">
            {getParticipantCount(
              user?.username ||
                user?.email ||
                (isPublicUser ? "Public User" : "You")
            )}{" "}
            Participants
          </Badge>
        </div>
      </header>
      <div className="flex-1 flex relative">
        {fullscreenParticipantId ? (
          <div className="flex flex-1">
            <main className="flex-1 flex items-center justify-center p-4">
              <div className="w-full h-full">
                {mainParticipantId && (
                  <VideoPlayer
                    stream={allStreams[mainParticipantId]}
                    name={
                      allParticipants.find((p) => p?.id === mainParticipantId)
                        ?.name || "Participant"
                    }
                    isMuted={mainParticipantId === (user?.id || "public-user")}
                    isSpeaking={
                      speakingParticipants[mainParticipantId] || false
                    }
                    onToggleFullscreen={() =>
                      handleToggleFullscreen(mainParticipantId)
                    }
                    isFullscreen={true}
                  />
                )}
              </div>
            </main>
            <aside className="w-48 flex-shrink-0 p-2 space-y-2 overflow-y-auto">
              {otherParticipantIds.map((id) => (
                <div key={id} className="aspect-video">
                  <VideoPlayer
                    stream={allStreams[id]}
                    name={
                      allParticipants.find((p) => p?.id === id)?.name ||
                      "Participant"
                    }
                    isMuted={id === (user?.id || "public-user")}
                    isSpeaking={speakingParticipants[id] || false}
                    onToggleFullscreen={() => handleToggleFullscreen(id)}
                    isFullscreen={false}
                  />
                </div>
              ))}
            </aside>
          </div>
        ) : (
          <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {Object.keys(allStreams).map((id) => (
              <VideoPlayer
                key={id}
                stream={allStreams[id]}
                name={
                  allParticipants.find((p) => p?.id === id)?.name ||
                  "Participant"
                }
                isMuted={id === (user?.id || "public-user")}
                isSpeaking={speakingParticipants[id] || false}
                onToggleFullscreen={() => handleToggleFullscreen(id)}
                isFullscreen={false}
              />
            ))}
          </main>
        )}

        <MeetingControls
          isMicOn={isMicOn}
          toggleMic={toggleMic}
          isVideoOn={isVideoOn}
          toggleVideo={toggleVideo}
          isScreenSharing={isScreenSharing}
          toggleScreenShare={toggleScreenShare}
          toggleChat={() => setChatOpen((prev) => !prev)}
          hangUp={hangUp}
        />

        <ChatPanel
          meetingId={meetingId}
          isOpen={isChatOpen}
          onClose={() => setChatOpen(false)}
        />

        <PublicUserJoinDialog
          isOpen={showJoinDialog}
          onOpenChange={setShowJoinDialog}
          meetingId={meetingId}
          onJoinSuccess={handleJoinSuccess}
          prefilledUserName={prefilledUserName}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicUserService } from "@/lib/public-user-service";
import { useToast } from "@/hooks/use-toast";

interface PublicUserJoinDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  onJoinSuccess: () => void;
  prefilledUserName?: string;
}

export function PublicUserJoinDialog({
  isOpen,
  onOpenChange,
  meetingId,
  onJoinSuccess,
  prefilledUserName = "",
}: PublicUserJoinDialogProps) {
  const [name, setName] = useState(prefilledUserName);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Request deduplication - prevent multiple simultaneous join requests
  const pendingRequests = useRef<Map<string, Promise<any>>>(new Map());

  // Update name when prefilledUserName changes
  useEffect(() => {
    if (prefilledUserName) {
      setName(prefilledUserName);
    }
  }, [prefilledUserName]);

  const handleJoin = async () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Nama tidak boleh kosong",
        variant: "destructive",
      });
      return;
    }

    const sessionId = publicUserService.getOrCreateSessionId();
    const requestKey = `${sessionId}_${meetingId}`;

    // REQUEST DEDUPLICATION - Check if there's already a pending request
    if (pendingRequests.current.has(requestKey)) {
      console.log(
        "[DEBUG] Join request already in progress for key:",
        requestKey
      );
      try {
        // Wait for the existing request to complete
        await pendingRequests.current.get(requestKey);
        // If successful, trigger success callback
        onJoinSuccess();
        onOpenChange(false);
      } catch (error) {
        // If the existing request failed, show error
        console.error("Pending join request failed:", error);
        toast({
          title: "Error",
          description: "Gagal bergabung ke meeting. Silakan coba lagi.",
          variant: "destructive",
        });
      }
      return;
    }

    setIsLoading(true);

    // Create and store the join promise
    const joinPromise = performJoin(sessionId, name.trim());
    pendingRequests.current.set(requestKey, joinPromise);

    try {
      await joinPromise;

      toast({
        title: "Berhasil",
        description: "Anda telah bergabung ke meeting",
      });

      onJoinSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error joining meeting as public user:", error);
      toast({
        title: "Error",
        description: "Gagal bergabung ke meeting. Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      // Clean up pending request
      pendingRequests.current.delete(requestKey);
      setIsLoading(false);
    }
  };

  const performJoin = async (sessionId: string, trimmedName: string) => {
    console.log(
      "[DEBUG] Performing join request for session:",
      sessionId,
      "meeting:",
      meetingId
    );

    // Check if user already exists with this session ID
    const existingUser = await publicUserService.getPublicUserBySessionId(
      sessionId
    );

    if (existingUser) {
      // User exists, just join the meeting
      console.log(
        "[DEBUG] Existing user found, joining meeting directly:",
        existingUser
      );
      await publicUserService.joinMeetingAsPublicUser({
        name: trimmedName,
        sessionId,
        meetingId,
      });
    } else {
      // New user, create first then join
      console.log("[DEBUG] Creating new public user");
      await publicUserService.createPublicUser({
        name: trimmedName,
        sessionId,
      });

      await publicUserService.joinMeetingAsPublicUser({
        name: trimmedName,
        sessionId,
        meetingId,
      });
    }

    console.log("[DEBUG] Join request completed successfully");
  };

  const handleClose = () => {
    // Dialog tidak bisa ditutup secara manual - user harus mengisi nama dan bergabung
    // Hanya bisa ditutup setelah berhasil bergabung (dipanggil dari handleJoin)
    return;
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={() => {
        /* Prevent closing */
      }}
    >
      <DialogContent
        className="sm:max-w-[425px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Bergabung ke Meeting</DialogTitle>
          <DialogDescription>
            {prefilledUserName
              ? `Selamat datang kembali, ${prefilledUserName}! Masukkan nama Anda untuk melanjutkan.`
              : "Masukkan nama Anda untuk bergabung ke meeting sebagai tamu."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Nama
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder={
                prefilledUserName ? "Nama Anda" : "Masukkan nama Anda"
              }
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isLoading) {
                  handleJoin();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleJoin}
            disabled={isLoading || !name.trim()}
            className="w-full"
          >
            {isLoading ? "Menggabungkan..." : "Bergabung ke Meeting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

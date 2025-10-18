"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useAuthContext } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { CreateMeetingRequest } from "@/lib/meeting-service";

const createMeetingSchema = z.object({
  name: z
    .string()
    .min(3, { message: "Meeting title must be at least 3 characters" }),
  description: z.string().optional(),
  startTime: z.string().optional(),
  duration: z.number().min(15).max(480).optional(),
});

type CreateMeetingFormValues = z.infer<typeof createMeetingSchema>;

interface CreateMeetingDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function CreateMeetingDialog({
  isOpen,
  onOpenChange,
}: CreateMeetingDialogProps) {
  const router = useRouter();
  const { user } = useAuthContext();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CreateMeetingFormValues>({
    resolver: zodResolver(createMeetingSchema),
    defaultValues: {
      name: "",
      description: "",
      startTime: new Date().toISOString(),
      duration: 60,
    },
  });

  const onSubmit = async (data: CreateMeetingFormValues) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create a meeting.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const meetingData: CreateMeetingRequest = {
        name: data.name,
        description: data.description || undefined,
        startTime: data.startTime || new Date().toISOString(),
        duration: data.duration || 60,
      };

      // Import meetingService directly to get the created meeting
      const { meetingService } = await import("@/lib/meeting-service");
      const meeting = await meetingService.createMeeting(meetingData);

      toast({
        title: "Success!",
        description: "Your meeting has been created.",
      });

      onOpenChange(false);
      form.reset();
      // Redirect to the new meeting room
      router.push(`/meeting/${meeting.id}`);
    } catch (error: any) {
      console.error("Error creating meeting:", error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description:
          error.message || "Could not create the meeting. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Meeting</DialogTitle>
          <DialogDescription>
            Give your meeting a name to get started. You can invite others
            later.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4 py-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <FormControl>
                    <Input
                      id="name"
                      placeholder="Team Sync"
                      className="col-span-3"
                      {...field}
                    />
                  </FormControl>
                  <div className="col-span-4 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create & Join Meeting"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

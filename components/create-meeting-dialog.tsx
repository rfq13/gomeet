"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";

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
    .min(3, { message: "Meeting name must be at least 3 characters" }),
  description: z.string().optional(),
  startTime: z.string().min(1, { message: "Meeting time is required" }),
  duration: z
    .number()
    .min(15, { message: "Duration must be at least 15 minutes" }),
});

type CreateMeetingFormValues = z.infer<typeof createMeetingSchema>;

interface CreateMeetingDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateMeeting?: (data: CreateMeetingRequest) => Promise<void>;
}

export function CreateMeetingDialog({
  isOpen,
  onOpenChange,
  onCreateMeeting,
}: CreateMeetingDialogProps) {
  const router = useRouter();
  const { user } = useAuthContext();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set default scheduled time to current time + 1 hour
  const defaultScheduledTime = new Date();
  defaultScheduledTime.setHours(defaultScheduledTime.getHours() + 1);

  const form = useForm<CreateMeetingFormValues>({
    resolver: zodResolver(createMeetingSchema),
    defaultValues: {
      name: "",
      description: "",
      startTime: format(defaultScheduledTime, "yyyy-MM-dd'T'HH:mm"),
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
        description: data.description,
        startTime: data.startTime,
        duration: data.duration,
      };

      if (onCreateMeeting) {
        await onCreateMeeting(meetingData);
      } else {
        // Fallback: direct API call if no callback provided
        const { meetingService } = await import("@/lib/meeting-service");
        const newMeeting = await meetingService.createMeeting(meetingData);

        toast({
          title: "Success!",
          description: "Your meeting has been created.",
        });

        onOpenChange(false);
        form.reset();

        // Redirect to the new meeting room
        router.push(`/meeting/${newMeeting.id}`);
        return;
      }

      toast({
        title: "Success!",
        description: "Your meeting has been created.",
      });

      onOpenChange(false);
      form.reset();
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Meeting</DialogTitle>
          <DialogDescription>
            Fill in the meeting details to get started. You can invite others
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
                  <Label htmlFor="title" className="text-right">
                    Title
                  </Label>
                  <FormControl>
                    <Input
                      id="title"
                      placeholder="Team Sync Meeting"
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

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="description" className="text-right">
                    Description
                  </Label>
                  <FormControl>
                    <Input
                      id="description"
                      placeholder="Weekly team synchronization"
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

            <FormField
              control={form.control}
              name="startTime"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="startTime" className="text-right">
                    Schedule
                  </Label>
                  <FormControl>
                    <Input
                      id="startTime"
                      type="datetime-local"
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

            <FormField
              control={form.control}
              name="duration"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="duration" className="text-right">
                    Duration (min)
                  </Label>
                  <FormControl>
                    <Input
                      id="duration"
                      type="number"
                      min="15"
                      max="480"
                      placeholder="60"
                      className="col-span-3"
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value) || 0)
                      }
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
                {isSubmitting ? "Creating..." : "Create Meeting"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

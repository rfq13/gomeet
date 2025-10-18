"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { format } from "date-fns";
import { MoreVertical, PlusCircle, Video } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateMeetingDialog } from "@/components/create-meeting-dialog";
import { useState } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { useMeetings } from "@/hooks/use-meetings";
import { Meeting, Participant } from "@/lib/meeting-service";

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const meetingDate = new Date(meeting.startTime);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{meeting.title}</CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{format(meetingDate, "PPP")}</span>
          <span>•</span>
          <span>{format(meetingDate, "p")}</span>
        </div>
      </CardHeader>
      <CardContent>
        {meeting.participants && meeting.participants.length > 0 ? (
          <>
            <div className="flex -space-x-2 overflow-hidden">
              {meeting.participants.map((p, index) => (
                <Avatar
                  key={index}
                  className="h-8 w-8 border-2 border-background"
                >
                  <AvatarImage
                    src={`https://picsum.photos/seed/${p.userId}/100/100`}
                    alt={p.name}
                    data-ai-hint="person face"
                  />
                  <AvatarFallback>{p.name.charAt(0)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {meeting.participants.length} participants
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No participants yet.</p>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Link href={`/meeting/${meeting.id}`} passHref>
          <Button>
            <Video className="mr-2 h-4 w-4" />
            Start Meeting
          </Button>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View Details</DropdownMenuItem>
            <DropdownMenuItem>Reschedule</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              Cancel Meeting
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}

function MeetingSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent>
        <div className="flex -space-x-2 overflow-hidden">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <Skeleton className="h-4 w-1/4 mt-2" />
      </CardContent>
      <CardFooter className="flex justify-between">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-10" />
      </CardFooter>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuthContext();
  const { meetings, loading, error, createMeeting, deleteMeeting } =
    useMeetings();
  const [isCreateMeetingOpen, setCreateMeetingOpen] = useState(false);

  const handleCreateMeeting = async (data: any) => {
    try {
      await createMeeting({
        name: data.name,
        description: data.description,
        startTime: data.startTime,
        duration: data.duration,
      });
      setCreateMeetingOpen(false);
    } catch (error) {
      console.error("Create meeting error:", error);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      await deleteMeeting(meetingId);
    } catch (error) {
      console.error("Delete meeting error:", error);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Please login to access dashboard</p>
      </div>
    );
  }

  return (
    <>
      <CreateMeetingDialog
        isOpen={isCreateMeetingOpen}
        onOpenChange={setCreateMeetingOpen}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Upcoming Meetings</h1>
        <Button
          className="bg-accent hover:bg-accent/90"
          onClick={() => setCreateMeetingOpen(true)}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Meeting
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => <MeetingSkeleton key={i} />)}
        {meetings &&
          meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
      </div>
      {!loading && meetings?.length === 0 && (
        <div className="text-center text-muted-foreground col-span-full mt-8">
          <p>No upcoming meetings. Create one to get started!</p>
        </div>
      )}
      {error && (
        <div className="text-center text-destructive col-span-full mt-8">
          <p>Error loading meetings: {error}</p>
        </div>
      )}
    </>
  );
}

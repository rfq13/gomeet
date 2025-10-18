"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MoreHorizontal,
  Reply,
  Edit,
  Trash2,
  Heart,
  ThumbsUp,
  Laugh,
  MessageSquare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatMessagesProps } from "@/types/chat";

// Helper function to format time
function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Helper function to get user initials
function getUserInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Message component
function MessageItem({
  message,
  isOwn,
  onEditMessage,
  onDeleteMessage,
  onAddReaction,
  onReplyToMessage,
}: {
  message: any;
  isOwn: boolean;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onAddReaction: (messageId: string, reaction: string) => void;
  onReplyToMessage: (messageId: string, content: string) => void;
}) {
  const user = message.user || message.publicUser;
  const userName = user?.username || user?.name || "Unknown User";
  const userAvatar = user?.avatar;
  const userInitials = getUserInitials(userName);

  const reactions = message.reactions || [];
  const replyTo = message.replyTo;

  return (
    <div
      className={cn(
        "flex items-start space-x-3 mb-4",
        isOwn && "flex-row-reverse space-x-reverse"
      )}
    >
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarImage src={userAvatar} alt={userName} />
        <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
      </Avatar>

      <div
        className={cn("flex-1 max-w-[70%]", isOwn && "flex flex-col items-end")}
      >
        {/* User name and timestamp */}
        <div
          className={cn(
            "flex items-center space-x-2 mb-1",
            isOwn && "flex-row-reverse space-x-reverse"
          )}
        >
          <span className="text-sm font-medium text-foreground">
            {userName}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatMessageTime(message.createdAt)}
          </span>
          {message.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>

        {/* Reply to message */}
        {replyTo && (
          <div
            className={cn(
              "mb-2 p-2 rounded-md bg-muted/50 border-l-2 border-muted-foreground/30",
              isOwn && "border-r-2 border-l-0"
            )}
          >
            <div className="text-xs text-muted-foreground mb-1">
              Replying to{" "}
              {replyTo.user?.username || replyTo.publicUser?.name || "Unknown"}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {replyTo.content}
            </div>
          </div>
        )}

        {/* Message content */}
        <div
          className={cn(
            "rounded-lg p-3 break-words",
            isOwn ? "bg-primary text-primary-foreground ml-auto" : "bg-muted"
          )}
        >
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div
            className={cn("flex flex-wrap gap-1 mt-2", isOwn && "justify-end")}
          >
            {reactions.map((reaction: any, index: number) => (
              <Badge
                key={index}
                variant="secondary"
                className="text-xs px-2 py-0.5 cursor-pointer hover:bg-muted-foreground/20"
                onClick={() => onAddReaction(message.id, reaction.reaction)}
              >
                {reaction.reaction} {reaction.count || 1}
              </Badge>
            ))}
          </div>
        )}

        {/* Message actions */}
        <div
          className={cn(
            "flex items-center space-x-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
            isOwn && "justify-end"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onReplyToMessage(message.id, message.content)}
          >
            <Reply className="h-3 w-3" />
          </Button>

          {isOwn && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEditMessage(message.id, message.content)}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onDeleteMessage(message.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isOwn ? "end" : "start"}>
              <DropdownMenuItem onClick={() => onAddReaction(message.id, "👍")}>
                <ThumbsUp className="h-3 w-3 mr-2" />
                👍 Like
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddReaction(message.id, "❤️")}>
                <Heart className="h-3 w-3 mr-2" />
                ❤️ Love
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddReaction(message.id, "😂")}>
                <Laugh className="h-3 w-3 mr-2" />
                😂 Funny
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  currentUserId,
  onEditMessage,
  onDeleteMessage,
  onAddReaction,
  onReplyToMessage,
  isLoading = false,
}: ChatMessagesProps) {
  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start space-x-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-16 w-full bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground mb-2">
          No messages yet
        </h3>
        <p className="text-sm text-muted-foreground">
          Start the conversation by sending a message below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {messages.map((message) => {
        // Determine if message is from current user by checking both userId and publicUserId
        const isOwn = Boolean(
          currentUserId &&
            (message.userId === currentUserId ||
              message.publicUserId === currentUserId)
        );

        return (
          <div key={message.id} className="group">
            <MessageItem
              message={message}
              isOwn={isOwn}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
              onAddReaction={onAddReaction}
              onReplyToMessage={onReplyToMessage}
            />
          </div>
        );
      })}
    </div>
  );
}

export default ChatMessages;

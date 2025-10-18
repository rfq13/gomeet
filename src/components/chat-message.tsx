"use client";

import React, { useState } from "react";
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
  Check,
  CheckCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatMessageProps } from "@/types/chat";

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

// Helper function to format full date
function formatFullDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Helper function to get user display name
function getUserDisplayName(user: any): string {
  if (user?.username) return user.username;
  if (user?.name) return user.name;
  return "Unknown User";
}

export function ChatMessage({
  message,
  isOwn,
  onEdit,
  onDelete,
  onAddReaction,
  onReply,
}: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const user = message.user || message.publicUser;
  const userName = getUserDisplayName(user);
  const userAvatar = user?.avatar;
  const userInitials = getUserInitials(userName);

  const reactions = message.reactions || [];
  const replyTo = message.replyTo;

  // Group reactions by type
  const groupedReactions = reactions.reduce((acc: any, reaction: any) => {
    const key = reaction.reaction;
    if (!acc[key]) {
      acc[key] = {
        reaction: key,
        count: 0,
        users: [],
      };
    }
    acc[key].count++;
    acc[key].users.push(reaction.user || reaction.publicUser);
    return acc;
  }, {});

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEdit(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const handleDelete = () => {
    onDelete(message.id);
    setIsDeleteDialogOpen(false);
  };

  const handleReply = () => {
    onReply(message.content, message.id);
  };

  const handleReaction = (reaction: string) => {
    onAddReaction(message.id, reaction);
  };

  return (
    <>
      <div
        className={cn(
          "flex items-start space-x-3 mb-4 group",
          isOwn && "flex-row-reverse space-x-reverse"
        )}
      >
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={userAvatar} alt={userName} />
          <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
        </Avatar>

        <div
          className={cn(
            "flex-1 max-w-[70%]",
            isOwn && "flex flex-col items-end"
          )}
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
            <span
              className="text-xs text-muted-foreground cursor-help"
              title={formatFullDate(message.createdAt)}
            >
              {formatMessageTime(message.createdAt)}
            </span>
            {message.isEdited && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}

            {/* Message status indicators */}
            {isOwn && (
              <div className="flex items-center space-x-1">
                {message.messageStatus === "sent" && (
                  <Check className="h-3 w-3 text-muted-foreground" />
                )}
                {message.messageStatus === "delivered" && (
                  <CheckCheck className="h-3 w-3 text-muted-foreground" />
                )}
                {message.messageStatus === "read" && (
                  <CheckCheck className="h-3 w-3 text-blue-500" />
                )}
              </div>
            )}
          </div>

          {/* Reply to message */}
          {replyTo && (
            <div
              className={cn(
                "mb-2 p-2 rounded-md bg-muted/50 border-l-2 border-muted-foreground/30 cursor-pointer hover:bg-muted/70 transition-colors",
                isOwn && "border-r-2 border-l-0"
              )}
            >
              <div className="text-xs text-muted-foreground mb-1">
                Replying to{" "}
                {getUserDisplayName(replyTo.user || replyTo.publicUser)}
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {replyTo.content}
              </div>
            </div>
          )}

          {/* Message content */}
          <div
            className={cn(
              "rounded-lg p-3 break-words relative",
              isOwn ? "bg-primary text-primary-foreground ml-auto" : "bg-muted",
              message.isDeleted && "opacity-60 italic"
            )}
          >
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[60px] resize-none"
                  placeholder="Edit your message..."
                  autoFocus
                />
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={!editContent.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed">
                {message.isDeleted
                  ? "This message was deleted"
                  : message.content}
              </p>
            )}
          </div>

          {/* Reactions */}
          {Object.keys(groupedReactions).length > 0 && (
            <div
              className={cn(
                "flex flex-wrap gap-1 mt-2",
                isOwn && "justify-end"
              )}
            >
              {Object.values(groupedReactions).map(
                (reaction: any, index: number) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="text-xs px-2 py-0.5 cursor-pointer hover:bg-muted-foreground/20 transition-colors"
                    onClick={() => handleReaction(reaction.reaction)}
                    title={reaction.users
                      .map((u: any) => getUserDisplayName(u))
                      .join(", ")}
                  >
                    {reaction.reaction} {reaction.count}
                  </Badge>
                )
              )}
            </div>
          )}

          {/* Message actions */}
          {!message.isDeleted && (
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
                onClick={handleReply}
                title="Reply"
              >
                <Reply className="h-3 w-3" />
              </Button>

              {isOwn && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsEditing(true)}
                    title="Edit"
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Add reaction"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isOwn ? "end" : "start"}>
                  <DropdownMenuItem onClick={() => handleReaction("👍")}>
                    <ThumbsUp className="h-3 w-3 mr-2" />
                    👍 Like
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReaction("❤️")}>
                    <Heart className="h-3 w-3 mr-2" />
                    ❤️ Love
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReaction("😂")}>
                    <Laugh className="h-3 w-3 mr-2" />
                    😂 Funny
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReaction("😮")}>
                    <MessageSquare className="h-3 w-3 mr-2" />
                    😮 Wow
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReaction("😢")}>
                    <MessageSquare className="h-3 w-3 mr-2" />
                    😢 Sad
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Message</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this message? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ChatMessage;

"use client";

import React, { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MessageCircle,
  X,
  Minimize2,
  Maximize2,
  Send,
  Smile,
  Paperclip,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChat } from "@/hooks/use-chat";
import type { ChatPanelProps } from "@/types/chat";

// Import sub-components
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { ChatMessageInput } from "./chat-message-input";

export function ChatPanel({
  meetingId,
  isOpen,
  onClose,
  className,
}: ChatPanelProps) {
  const {
    messages,
    unreadCount,
    isLoading,
    error,
    isConnected,
    typingUsers,
    sendMessage,
    editMessage,
    deleteMessage,
    addReaction,
    markAsRead,
    toggleTyping,
  } = useChat({
    meetingId,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMinimized, setIsMinimized] = React.useState(false);
  const [replyToMessage, setReplyToMessage] = React.useState<any>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!isMinimized && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isMinimized]);

  // Mark as read when panel is opened
  useEffect(() => {
    if (isOpen && !isMinimized && unreadCount > 0) {
      markAsRead();
    }
  }, [isOpen, isMinimized, unreadCount, markAsRead]);

  const handleSendMessage = async (content: string, replyToId?: string) => {
    try {
      await sendMessage(content, replyToId);
      setReplyToMessage(null);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    try {
      await editMessage(messageId, content);
    } catch (error) {
      console.error("Failed to edit message:", error);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteMessage(messageId);
    } catch (error) {
      console.error("Failed to delete message:", error);
    }
  };

  const handleAddReaction = async (messageId: string, reaction: string) => {
    try {
      await addReaction(messageId, reaction);
    } catch (error) {
      console.error("Failed to add reaction:", error);
    }
  };

  const handleReplyToMessage = (messageId: string, content: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      setReplyToMessage(message);
    }
  };

  const handleCancelReply = () => {
    setReplyToMessage(null);
  };

  const handleTypingStart = () => {
    // Typing indicators are handled by the useChat hook
    toggleTyping();
  };

  const handleTypingStop = () => {
    // Typing indicators are handled by the useChat hook
    // Auto-stop will be handled by the hook
  };

  const handleToggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-background border rounded-lg shadow-lg",
        "w-80 h-96 max-h-[600px]",
        isMinimized && "h-auto",
        className
      )}
    >
      {/* Chat Header */}
      <ChatHeader
        unreadCount={unreadCount}
        isMinimized={isMinimized}
        onToggleMinimize={handleToggleMinimize}
        onClose={onClose}
      />

      {/* Chat Content */}
      {!isMinimized && (
        <>
          {/* Messages Area */}
          <div className="flex-1 flex flex-col min-h-0">
            {isLoading ? (
              <div className="flex-1 p-4 space-y-4">
                <div className="flex items-start space-x-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </div>
                <div className="flex items-start space-x-3 justify-end">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24 ml-auto" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
                <div className="flex items-start space-x-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-12 w-3/4" />
                  </div>
                </div>
              </div>
            ) : (
              <ScrollArea className="flex-1 p-4">
                <ChatMessages
                  messages={messages}
                  currentUserId={undefined} // Will be determined by useChat hook
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={handleDeleteMessage}
                  onAddReaction={handleAddReaction}
                  onReplyToMessage={(content: string, replyToId?: string) => {
                    if (replyToId) {
                      handleReplyToMessage(replyToId, content);
                    }
                  }}
                  isLoading={isLoading}
                />
                <div ref={messagesEndRef} />
              </ScrollArea>
            )}

            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-2 text-sm text-muted-foreground">
                {typingUsers.map((user) => user.name).join(", ")}
                {typingUsers.length === 1 ? " is" : " are"} typing...
              </div>
            )}
          </div>

          {/* Message Input */}
          <div className="border-t p-4">
            <ChatMessageInput
              onSendMessage={handleSendMessage}
              onTypingStart={handleTypingStart}
              onTypingStop={handleTypingStop}
              disabled={!isConnected}
              replyToMessage={
                replyToMessage
                  ? {
                      id: replyToMessage.id,
                      content: replyToMessage.content,
                      userName:
                        replyToMessage.user?.username ||
                        replyToMessage.publicUser?.name ||
                        "Unknown",
                    }
                  : undefined
              }
              onCancelReply={handleCancelReply}
            />
          </div>

          {/* Connection Status */}
          <div className="border-t px-4 py-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    isConnected ? "bg-green-500" : "bg-red-500"
                  )}
                />
                <span className="text-muted-foreground">
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <div className="flex items-center space-x-1 text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Online</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Export a simplified version for now until sub-components are created
export default ChatPanel;

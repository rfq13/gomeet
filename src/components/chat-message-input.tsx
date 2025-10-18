"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Smile, Paperclip, X, Reply } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ChatMessageInputProps } from "@/types/chat";

// Common reactions for quick access
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎", "🔥", "🎉"];

export function ChatMessageInput({
  onSendMessage,
  onTypingStart,
  onTypingStop,
  disabled = false,
  replyToMessage,
  onCancelReply,
  className,
}: ChatMessageInputProps) {
  const [message, setMessage] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [message]);

  // Handle typing indicators
  const handleTyping = () => {
    if (!isComposing && message.trim()) {
      onTypingStart();

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set new timeout to stop typing after 1 second of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        onTypingStop();
      }, 1000);
    }
  };

  // Handle message send
  const handleSend = () => {
    const trimmedMessage = message.trim();

    if (!trimmedMessage || disabled) {
      return;
    }

    onSendMessage(trimmedMessage, replyToMessage?.id);
    setMessage("");

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      onTypingStop();
    }

    // Clear reply if exists
    if (replyToMessage && onCancelReply) {
      onCancelReply();
    }

    // Focus back to textarea
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape" && replyToMessage && onCancelReply) {
      onCancelReply();
    }
  };

  // Handle file attachment (placeholder for now)
  const handleFileAttach = () => {
    // This will be implemented later
    console.log("File attachment not implemented yet");
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Reply to message indicator */}
      {replyToMessage && (
        <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md border-l-2 border-primary">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <Reply className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-primary">
                Replying to {replyToMessage.userName}
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {replyToMessage.content}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={onCancelReply}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Message input area */}
      <div className="flex items-end space-x-2">
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder={
              replyToMessage ? "Write a reply..." : "Type a message..."
            }
            disabled={disabled}
            className="min-h-[40px] max-h-[120px] resize-none pr-12"
            rows={1}
          />

          {/* Character count indicator */}
          {message.length > 1000 && (
            <div className="absolute bottom-1 right-1 text-xs text-muted-foreground">
              {message.length}/2000
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-1">
          {/* Emoji picker (simplified version) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                disabled={disabled}
              >
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="end">
              <div className="grid grid-cols-4 gap-1">
                {QUICK_REACTIONS.map((reaction) => (
                  <Button
                    key={reaction}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-lg"
                    onClick={() => {
                      setMessage((prev) => prev + reaction);
                      if (textareaRef.current) {
                        textareaRef.current.focus();
                      }
                    }}
                  >
                    {reaction}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* File attachment */}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleFileAttach}
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={!message.trim() || disabled}
            size="icon"
            className="h-10 w-10"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Input hints */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center space-x-2">
          <span>Press Enter to send, Shift+Enter for new line</span>
          {replyToMessage && <span>• Press Escape to cancel reply</span>}
        </div>
        {message.length > 1500 && (
          <Badge variant="outline" className="text-xs">
            {message.length}/2000
          </Badge>
        )}
      </div>
    </div>
  );
}

export default ChatMessageInput;

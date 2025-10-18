"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, X, Minimize2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatHeaderProps } from "@/types/chat";

export function ChatHeader({
  unreadCount,
  isMinimized,
  onToggleMinimize,
  onClose,
  className,
}: ChatHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 border-b bg-muted/50",
        className
      )}
    >
      <div className="flex items-center space-x-3">
        <MessageCircle className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Chat</h3>
        {unreadCount > 0 && (
          <Badge variant="destructive" className="h-5 px-2 text-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </div>

      <div className="flex items-center space-x-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleMinimize}
          className="h-8 w-8"
        >
          {isMinimized ? (
            <Maximize2 className="h-4 w-4" />
          ) : (
            <Minimize2 className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default ChatHeader;

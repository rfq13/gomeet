import { useState, useEffect, useCallback, useRef } from "react";
import { createChatService, ChatService } from "@/lib/chat-service";
import { apiClient } from "@/lib/api-client";
import { APIException } from "@/lib/api-client";
import { useAuthContext } from "@/contexts/auth-context";
import {
  ChatMessage,
  ChatState,
  TypingUser,
  UseChatOptions,
  UseChatReturn,
  PaginationInfo,
} from "@/types/chat";

export function useChat(
  { meetingId, userId, publicUserId }: UseChatOptions,
  externalWebSocketService?: any
): UseChatReturn {
  const { user } = useAuthContext();
  const [state, setState] = useState<ChatState>({
    messages: [],
    unreadCount: 0,
    isLoading: true,
    error: null,
    isConnected: false,
    typingUsers: [],
    pagination: null,
  });

  const chatServiceRef = useRef<ChatService | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize chat service
  const initializeChat = useCallback(async () => {
    if (isInitializedRef.current) return;

    try {
      const token = apiClient.getAccessToken();
      const sessionId =
        typeof window !== "undefined"
          ? localStorage.getItem("sessionId")
          : null;

      const config = {
        apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081",
        wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8081",
        meetingId,
        token: token || undefined,
        sessionId: sessionId || undefined,
        retryAttempts: 3,
        retryDelay: 1000,
      };

      const chatService = createChatService(config, externalWebSocketService);
      chatServiceRef.current = chatService;

      // Set up event listeners
      chatService.on("connected", () => {
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      });

      chatService.on("disconnected", () => {
        setState((prev) => ({ ...prev, isConnected: false }));
      });

      chatService.on("message-received", (message: ChatMessage) => {
        if (!message) {
          console.warn("Received null or undefined message");
          return;
        }

        // Validate message structure
        if (!message.id || !message.content) {
          console.warn("Invalid message structure:", message);
          return;
        }

        setState((prev) => {
          // Check if message already exists to avoid duplicates
          const messageExists = prev.messages.some(
            (msg) => msg.id === message.id
          );
          if (messageExists) {
            console.warn("Message already exists, skipping:", message.id);
            return prev;
          }

          return {
            ...prev,
            messages: [...(prev.messages || []), message],
            unreadCount: (prev.unreadCount || 0) + 1,
          };
        });
      });

      chatService.on("message-edited", (messageId: string, content: string) => {
        if (!messageId || content === undefined || content === null) {
          console.warn("Invalid message edit data:", { messageId, content });
          return;
        }

        setState((prev) => ({
          ...prev,
          messages: (prev.messages || []).map((msg) =>
            msg.id === messageId ? { ...msg, content, isEdited: true } : msg
          ),
        }));
      });

      chatService.on("message-deleted", (messageId: string) => {
        if (!messageId) {
          console.warn("Invalid message ID for deletion");
          return;
        }

        setState((prev) => ({
          ...prev,
          messages: (prev.messages || []).map((msg) =>
            msg.id === messageId
              ? { ...msg, isDeleted: true, content: "This message was deleted" }
              : msg
          ),
        }));
      });

      chatService.on(
        "reaction-added",
        (messageId: string, reaction: string) => {
          if (!messageId || !reaction) {
            console.warn("Invalid reaction data:", { messageId, reaction });
            return;
          }

          setState((prev) => ({
            ...prev,
            messages: (prev.messages || []).map((msg) => {
              if (msg.id === messageId) {
                const existingReaction = msg.reactions?.find(
                  (r) => r.reaction === reaction
                );
                if (existingReaction) {
                  // Increment reaction count if it exists
                  return {
                    ...msg,
                    reactions:
                      msg.reactions?.map((r) =>
                        r.reaction === reaction
                          ? { ...r, count: (r.count || 1) + 1 }
                          : r
                      ) || [],
                  };
                } else {
                  // Add new reaction
                  return {
                    ...msg,
                    reactions: [
                      ...(msg.reactions || []),
                      {
                        id: `${messageId}-${reaction}-${Date.now()}`,
                        messageId,
                        reaction,
                        createdAt: new Date().toISOString(),
                        userId,
                        publicUserId,
                        count: 1,
                      },
                    ],
                  };
                }
              }
              return msg;
            }),
          }));
        }
      );

      chatService.on(
        "reaction-removed",
        (messageId: string, reaction: string) => {
          if (!messageId || !reaction) {
            console.warn("Invalid reaction removal data:", {
              messageId,
              reaction,
            });
            return;
          }

          setState((prev) => ({
            ...prev,
            messages: (prev.messages || []).map((msg) => {
              if (msg.id === messageId) {
                return {
                  ...msg,
                  reactions:
                    msg.reactions?.filter((r) => r.reaction !== reaction) || [],
                };
              }
              return msg;
            }),
          }));
        }
      );

      chatService.on("typing-start", (user: TypingUser) => {
        if (!user || !user.id) {
          console.warn("Invalid typing user data:", user);
          return;
        }

        setState((prev) => {
          // Check if user is already typing
          const existingUser = prev.typingUsers?.find((u) => u.id === user.id);
          if (existingUser) {
            return prev; // User already typing, no update needed
          }

          return {
            ...prev,
            typingUsers: [
              ...(prev.typingUsers || []),
              { ...user, isTyping: true },
            ],
          };
        });
      });

      chatService.on("typing-stop", (userId: string) => {
        if (!userId) {
          console.warn("Invalid user ID for typing stop");
          return;
        }

        setState((prev) => ({
          ...prev,
          typingUsers: (prev.typingUsers || []).filter((u) => u.id !== userId),
        }));
      });

      chatService.on("messages-read", () => {
        setState((prev) => ({ ...prev, unreadCount: 0 }));
      });

      chatService.on("error", (error: Error) => {
        console.error("Chat service error:", error);
        setState((prev) => ({
          ...prev,
          error: error.message,
          isLoading: false,
        }));
      });

      // Initialize the service
      await chatService.initialize();

      // Load initial messages
      await loadMessages();

      isInitializedRef.current = true;
    } catch (error) {
      handleError(error);
    }
  }, [meetingId, userId, publicUserId]);

  // Load messages
  const loadMessages = useCallback(async (page: number = 1) => {
    if (!chatServiceRef.current) return;

    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const response = await chatServiceRef.current.getMessages(page, 50);

      // Validate response structure
      if (!response) {
        throw new Error("Invalid response: Response is null or undefined");
      }

      if (!response.messages) {
        console.warn(
          "Response messages is null or undefined, using empty array"
        );
        response.messages = [];
      }

      if (!Array.isArray(response.messages)) {
        console.warn("Response messages is not an array, converting to array");
        response.messages = [];
      }

      // Sort messages by createdAt timestamp (oldest first)
      const sortedMessages = [...response.messages].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      if (page === 1) {
        // Initial load - replace messages
        setState((prev) => ({
          ...prev,
          messages: sortedMessages,
          pagination: response.pagination || null,
          isLoading: false,
        }));
      } else {
        // Load more - prepend messages and avoid duplicates
        setState((prev) => {
          const existingIds = new Set(
            (prev.messages || []).map((msg) => msg.id)
          );
          const newMessages = sortedMessages.filter(
            (msg) => !existingIds.has(msg.id)
          );

          return {
            ...prev,
            messages: [...newMessages, ...(prev.messages || [])],
            pagination: response.pagination || null,
            isLoading: false,
          };
        });
      }
    } catch (error) {
      handleError(error);
    }
  }, []);

  // Handle errors
  const handleError = useCallback((error: unknown) => {
    console.error("Chat error:", error);

    let errorMessage = "An unknown error occurred";

    if (error instanceof APIException) {
      errorMessage = error.error?.message || "API error occurred";
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    setState((prev) => ({
      ...prev,
      error: errorMessage,
      isLoading: false,
      // Ensure messages array exists even on error
      messages: prev.messages || [],
    }));
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (content: string, replyToId?: string) => {
      if (!chatServiceRef.current) {
        console.warn("Chat service not available");
        return;
      }

      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        const error = new Error(
          "Message content is required and must be non-empty"
        );
        handleError(error);
        throw error;
      }

      try {
        await chatServiceRef.current.sendMessage(content.trim(), replyToId);
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
    [handleError]
  );

  // Edit message
  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!chatServiceRef.current) {
        console.warn("Chat service not available");
        return;
      }

      if (
        !messageId ||
        typeof messageId !== "string" ||
        messageId.trim().length === 0
      ) {
        const error = new Error("Message ID is required and must be non-empty");
        handleError(error);
        throw error;
      }

      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        const error = new Error(
          "Message content is required and must be non-empty"
        );
        handleError(error);
        throw error;
      }

      try {
        await chatServiceRef.current.editMessage(
          messageId.trim(),
          content.trim()
        );
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
    [handleError]
  );

  // Delete message
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!chatServiceRef.current) {
        console.warn("Chat service not available");
        return;
      }

      if (
        !messageId ||
        typeof messageId !== "string" ||
        messageId.trim().length === 0
      ) {
        const error = new Error("Message ID is required and must be non-empty");
        handleError(error);
        throw error;
      }

      try {
        await chatServiceRef.current.deleteMessage(messageId.trim());
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
    [handleError]
  );

  // Mark as read
  const markAsRead = useCallback(async () => {
    if (!chatServiceRef.current) return;

    try {
      await chatServiceRef.current.markAsRead();
      setState((prev) => ({ ...prev, unreadCount: 0 }));
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [handleError]);

  // Load more messages
  const loadMoreMessages = useCallback(async () => {
    if (
      !state.pagination ||
      state.pagination.page >= state.pagination.totalPages ||
      !chatServiceRef.current
    ) {
      return;
    }

    await loadMessages(state.pagination.page + 1);
  }, [state.pagination, loadMessages]);

  // Toggle typing
  const toggleTyping = useCallback(() => {
    if (!chatServiceRef.current) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    const userName = user?.username || user?.email || "Anonymous User";
    try {
      chatServiceRef.current.sendTypingStart(userName);
    } catch (error) {
      console.error("Failed to send typing start:", error);
      return;
    }

    typingTimeoutRef.current = setTimeout(() => {
      try {
        chatServiceRef.current?.sendTypingStop(userName);
      } catch (error) {
        console.error("Failed to send typing stop:", error);
      }
      typingTimeoutRef.current = null;
    }, 3000);
  }, [user]);

  // Add reaction
  const addReaction = useCallback(
    async (messageId: string, reaction: string) => {
      if (!chatServiceRef.current) {
        console.warn("Chat service not available");
        return;
      }

      if (
        !messageId ||
        typeof messageId !== "string" ||
        messageId.trim().length === 0
      ) {
        const error = new Error("Message ID is required and must be non-empty");
        handleError(error);
        throw error;
      }

      if (
        !reaction ||
        typeof reaction !== "string" ||
        reaction.trim().length === 0
      ) {
        const error = new Error("Reaction is required and must be non-empty");
        handleError(error);
        throw error;
      }

      try {
        await chatServiceRef.current.addReaction(
          messageId.trim(),
          reaction.trim()
        );
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
    [handleError]
  );

  // Remove reaction
  const removeReaction = useCallback(
    async (messageId: string, reaction: string) => {
      if (!chatServiceRef.current) {
        console.warn("Chat service not available");
        return;
      }

      if (
        !messageId ||
        typeof messageId !== "string" ||
        messageId.trim().length === 0
      ) {
        const error = new Error("Message ID is required and must be non-empty");
        handleError(error);
        throw error;
      }

      if (
        !reaction ||
        typeof reaction !== "string" ||
        reaction.trim().length === 0
      ) {
        const error = new Error("Reaction is required and must be non-empty");
        handleError(error);
        throw error;
      }

      try {
        await chatServiceRef.current.removeReaction(
          messageId.trim(),
          reaction.trim()
        );
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
    [handleError]
  );

  // Reconnect
  const reconnect = useCallback(async () => {
    if (!chatServiceRef.current) return;

    try {
      await chatServiceRef.current.reconnect();
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [handleError]);

  // Initialize on mount
  useEffect(() => {
    if (meetingId) {
      initializeChat();
    }

    // Cleanup on unmount
    return () => {
      if (chatServiceRef.current) {
        chatServiceRef.current.disconnect();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [meetingId, initializeChat]);

  return {
    // State
    messages: state.messages,
    unreadCount: state.unreadCount,
    isLoading: state.isLoading,
    error: state.error,
    typingUsers: state.typingUsers,
    isConnected: state.isConnected,

    // Actions
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    loadMoreMessages,
    toggleTyping,
    addReaction,
    removeReaction,
    reconnect,

    // Method to handle WebSocket messages from external source
    handleWebSocketMessage: (message: any) => {
      if (chatServiceRef.current) {
        // Use the public method to handle WebSocket messages
        try {
          // Create a proper WebSocket message format
          const wsMessage = {
            type: message.type,
            meetingId: meetingId,
            from: message.from || "unknown",
            data: message.data || {},
            timestamp: message.timestamp || new Date().toISOString(),
          };

          // Call the private method through a public interface
          if (
            typeof (chatServiceRef.current as any).handleWebSocketMessage ===
            "function"
          ) {
            (chatServiceRef.current as any).handleWebSocketMessage(wsMessage);
          } else {
            console.warn(
              "handleWebSocketMessage method not available on chat service"
            );
          }
        } catch (error) {
          console.error("Error handling WebSocket message:", error);
        }
      }
    },
  };
}

// Hook for typing indicator management
export function useTypingIndicator(chatService: ChatService | null) {
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startTyping = useCallback(() => {
    if (!chatService || isTyping) return;

    try {
      setIsTyping(true);
      chatService.sendTypingStart();

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Auto-stop typing after 3 seconds
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 3000);
    } catch (error) {
      console.error("Failed to start typing indicator:", error);
      setIsTyping(false);
    }
  }, [chatService, isTyping]);

  const stopTyping = useCallback(() => {
    if (!chatService || !isTyping) return;

    try {
      setIsTyping(false);
      chatService.sendTypingStop();
    } catch (error) {
      console.error("Failed to stop typing indicator:", error);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [chatService, isTyping]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return {
    isTyping,
    startTyping,
    stopTyping,
  };
}

// Hook for message pagination
export function useMessagePagination(
  loadMore: () => Promise<void>,
  hasMore: boolean,
  isLoading: boolean
) {
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      if (typeof loadMore === "function") {
        await loadMore();
      }
    } catch (error) {
      console.error("Failed to load more messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [loadMore, hasMore, isLoading, isLoadingMore]);

  return {
    isLoadingMore,
    handleLoadMore,
  };
}

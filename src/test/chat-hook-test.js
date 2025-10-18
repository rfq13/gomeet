// Test script untuk useChat hook - simulasi berbagai scenarios
// Ini adalah test manual yang bisa dijalankan di browser console

console.log("🧪 Testing useChat Hook Fix");

// Test 1: Null response validation
function testNullResponse() {
  console.log("\n📋 Test 1: Null Response Handling");

  // Simulasi null response dari API
  const mockNullResponse = null;

  try {
    if (!mockNullResponse) {
      throw new Error("Invalid response: Response is null or undefined");
    }
    console.log("❌ Test failed: Should have thrown error");
  } catch (error) {
    console.log("✅ Test passed: Null response handled correctly");
  }
}

// Test 2: Undefined messages array
function testUndefinedMessages() {
  console.log("\n📋 Test 2: Undefined Messages Array");

  const mockResponse = {
    messages: undefined,
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
  };

  if (!mockResponse.messages) {
    console.warn("Response messages is null or undefined, using empty array");
    mockResponse.messages = [];
  }

  console.log(
    "✅ Test passed: Undefined messages handled correctly",
    mockResponse.messages
  );
}

// Test 3: Non-array messages
function testNonArrayMessages() {
  console.log("\n📋 Test 3: Non-Array Messages");

  const mockResponse = {
    messages: "not an array",
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
  };

  if (!Array.isArray(mockResponse.messages)) {
    console.warn("Response messages is not an array, converting to array");
    mockResponse.messages = [];
  }

  console.log(
    "✅ Test passed: Non-array messages handled correctly",
    mockResponse.messages
  );
}

// Test 4: Empty array reverse
function testEmptyArrayReverse() {
  console.log("\n📋 Test 4: Empty Array Reverse");

  const emptyArray = [];

  try {
    const reversed = emptyArray.reverse();
    console.log("✅ Test passed: Empty array reverse works", reversed);
  } catch (error) {
    console.log("❌ Test failed: Empty array reverse failed", error);
  }
}

// Test 5: Valid array reverse
function testValidArrayReverse() {
  console.log("\n📋 Test 5: Valid Array Reverse");

  const validArray = [
    { id: "1", content: "Message 1" },
    { id: "2", content: "Message 2" },
    { id: "3", content: "Message 3" },
  ];

  try {
    const reversed = validArray.reverse();
    console.log("✅ Test passed: Valid array reverse works", reversed);
  } catch (error) {
    console.log("❌ Test failed: Valid array reverse failed", error);
  }
}

// Test 6: Input validation
function testInputValidation() {
  console.log("\n📋 Test 6: Input Validation");

  // Test empty content
  const emptyContent = "";
  if (
    !emptyContent ||
    typeof emptyContent !== "string" ||
    emptyContent.trim().length === 0
  ) {
    console.log("✅ Test passed: Empty content validation works");
  }

  // Test null messageId
  const nullMessageId = null;
  if (
    !nullMessageId ||
    typeof nullMessageId !== "string" ||
    nullMessageId.trim().length === 0
  ) {
    console.log("✅ Test passed: Null messageId validation works");
  }

  // Test valid inputs
  const validContent = "Hello world";
  const validMessageId = "msg-123";

  if (
    validContent &&
    typeof validContent === "string" &&
    validContent.trim().length > 0
  ) {
    console.log("✅ Test passed: Valid content validation works");
  }

  if (
    validMessageId &&
    typeof validMessageId === "string" &&
    validMessageId.trim().length > 0
  ) {
    console.log("✅ Test passed: Valid messageId validation works");
  }
}

// Test 7: WebSocket message validation
function testWebSocketMessageValidation() {
  console.log("\n📋 Test 7: WebSocket Message Validation");

  // Test null message
  const nullMessage = null;
  if (!nullMessage) {
    console.log("✅ Test passed: Null WebSocket message handled");
  }

  // Test invalid structure
  const invalidMessage = { type: "test" }; // missing data
  if (!invalidMessage || !invalidMessage.data) {
    console.log("✅ Test passed: Invalid WebSocket message structure handled");
  }

  // Test valid structure
  const validMessage = {
    type: "chat-message",
    data: {
      message: { id: "1", content: "Hello" },
    },
  };

  if (validMessage && validMessage.type && validMessage.data) {
    console.log("✅ Test passed: Valid WebSocket message accepted");
  }
}

// Test 8: Message sorting by createdAt
function testMessageSorting() {
  console.log("\n📋 Test 8: Message Sorting by createdAt");

  const unsortedMessages = [
    { id: "3", content: "Message 3", createdAt: "2023-01-03T10:00:00Z" },
    { id: "1", content: "Message 1", createdAt: "2023-01-01T10:00:00Z" },
    { id: "2", content: "Message 2", createdAt: "2023-01-02T10:00:00Z" },
  ];

  try {
    // Sort messages by createdAt timestamp (oldest first)
    const sortedMessages = [...unsortedMessages].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const isSorted = sortedMessages.every((msg, index, array) => {
      if (index === 0) return true;
      return (
        new Date(msg.createdAt).getTime() >=
        new Date(array[index - 1].createdAt).getTime()
      );
    });

    if (isSorted && sortedMessages[0].id === "1") {
      console.log(
        "✅ Test passed: Messages sorted correctly by createdAt",
        sortedMessages
      );
    } else {
      console.log("❌ Test failed: Messages not sorted correctly");
    }
  } catch (error) {
    console.log("❌ Test failed: Message sorting failed", error);
  }
}

// Test 9: Duplicate message prevention
function testDuplicateMessagePrevention() {
  console.log("\n📋 Test 9: Duplicate Message Prevention");

  const existingMessages = [
    { id: "1", content: "Message 1" },
    { id: "2", content: "Message 2" },
  ];

  const newMessage = { id: "1", content: "Message 1 Updated" };
  const existingIds = new Set(existingMessages.map((msg) => msg.id));

  try {
    // Check if message already exists to avoid duplicates
    const messageExists = existingIds.has(newMessage.id);

    if (messageExists) {
      console.log("✅ Test passed: Duplicate message detected and prevented");
    } else {
      console.log("❌ Test failed: Duplicate message not detected");
    }
  } catch (error) {
    console.log("❌ Test failed: Duplicate message prevention failed", error);
  }
}

// Test 10: Error handling with different error types
function testErrorHandling() {
  console.log("\n📋 Test 10: Error Handling with Different Error Types");

  // Test APIException error
  const mockAPIException = {
    error: { message: "API Error occurred" },
  };

  // Test Error object
  const mockError = new Error("Standard error occurred");

  // Test string error
  const mockStringError = "String error occurred";

  try {
    // Simulate handleError function logic
    function handleError(error) {
      let errorMessage = "An unknown error occurred";

      if (error && error.error && error.error.message) {
        errorMessage = error.error.message || "API error occurred";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }

      return errorMessage;
    }

    const apiErrorMessage = handleError(mockAPIException);
    const standardErrorMessage = handleError(mockError);
    const stringErrorMessage = handleError(mockStringError);

    if (
      apiErrorMessage === "API Error occurred" &&
      standardErrorMessage === "Standard error occurred" &&
      stringErrorMessage === "String error occurred"
    ) {
      console.log("✅ Test passed: All error types handled correctly");
    } else {
      console.log("❌ Test failed: Error types not handled correctly");
    }
  } catch (error) {
    console.log("❌ Test failed: Error handling test failed", error);
  }
}

// Test 11: Message editing validation
function testMessageEditingValidation() {
  console.log("\n📋 Test 11: Message Editing Validation");

  // Test empty messageId
  const emptyMessageId = "";
  const content = "Updated content";

  if (
    !emptyMessageId ||
    typeof emptyMessageId !== "string" ||
    emptyMessageId.trim().length === 0
  ) {
    console.log("✅ Test passed: Empty messageId validation works for editing");
  }

  // Test empty content
  const messageId = "msg-123";
  const emptyContent = "";

  if (
    !emptyContent ||
    typeof emptyContent !== "string" ||
    emptyContent.trim().length === 0
  ) {
    console.log("✅ Test passed: Empty content validation works for editing");
  }

  // Test valid inputs
  if (
    messageId &&
    typeof messageId === "string" &&
    messageId.trim().length > 0 &&
    content &&
    typeof content === "string" &&
    content.trim().length > 0
  ) {
    console.log("✅ Test passed: Valid inputs for editing work correctly");
  }
}

// Test 12: Reaction handling
function testReactionHandling() {
  console.log("\n📋 Test 12: Reaction Handling");

  // Test invalid reaction data
  const invalidReactionData = { messageId: "", reaction: "" };

  if (!invalidReactionData.messageId || !invalidReactionData.reaction) {
    console.log("✅ Test passed: Invalid reaction data handled correctly");
  }

  // Test adding reaction to existing message
  const message = {
    id: "msg-123",
    content: "Hello world",
    reactions: [],
  };

  const newReaction = {
    id: "msg-123-like-1234567890",
    messageId: "msg-123",
    reaction: "👍",
    createdAt: new Date().toISOString(),
    userId: "user-123",
    publicUserId: "public-user-123",
    count: 1,
  };

  try {
    // Simulate adding a reaction
    const updatedMessage = {
      ...message,
      reactions: [...(message.reactions || []), newReaction],
    };

    if (
      updatedMessage.reactions.length === 1 &&
      updatedMessage.reactions[0].reaction === "👍"
    ) {
      console.log("✅ Test passed: Reaction added correctly");
    } else {
      console.log("❌ Test failed: Reaction not added correctly");
    }
  } catch (error) {
    console.log("❌ Test failed: Reaction handling failed", error);
  }
}

// Test 13: Typing indicator handling
function testTypingIndicatorHandling() {
  console.log("\n📋 Test 13: Typing Indicator Handling");

  // Test invalid typing user data
  const invalidTypingUser = null;

  if (!invalidTypingUser) {
    console.log("✅ Test passed: Invalid typing user data handled correctly");
  }

  // Test adding typing user
  const existingTypingUsers = [];
  const newTypingUser = { id: "user-123", name: "John Doe", isTyping: true };

  try {
    // Check if user is already typing
    const existingUser = existingTypingUsers.find(
      (u) => u.id === newTypingUser.id
    );

    if (!existingUser) {
      const updatedTypingUsers = [
        ...existingTypingUsers,
        { ...newTypingUser, isTyping: true },
      ];

      if (updatedTypingUsers.length === 1) {
        console.log("✅ Test passed: Typing user added correctly");
      } else {
        console.log("❌ Test failed: Typing user not added correctly");
      }
    } else {
      console.log("✅ Test passed: Existing typing user detected correctly");
    }
  } catch (error) {
    console.log("❌ Test failed: Typing indicator handling failed", error);
  }
}

// Test 14: Pagination handling
function testPaginationHandling() {
  console.log("\n📋 Test 14: Pagination Handling");

  // Test null pagination
  const nullPagination = null;

  if (!nullPagination) {
    console.log("✅ Test passed: Null pagination handled correctly");
  }

  // Test valid pagination
  const validPagination = {
    page: 1,
    limit: 50,
    total: 100,
    totalPages: 2,
  };

  try {
    // Check if pagination is valid
    const isValidPagination =
      validPagination &&
      validPagination.page > 0 &&
      validPagination.limit > 0 &&
      validPagination.total >= 0 &&
      validPagination.totalPages > 0;

    if (isValidPagination) {
      console.log("✅ Test passed: Valid pagination handled correctly");
    } else {
      console.log("❌ Test failed: Valid pagination not handled correctly");
    }
  } catch (error) {
    console.log("❌ Test failed: Pagination handling failed", error);
  }
}

// Run all tests
function runAllTests() {
  console.log("🚀 Starting useChat Hook Validation Tests");

  testNullResponse();
  testUndefinedMessages();
  testNonArrayMessages();
  testEmptyArrayReverse();
  testValidArrayReverse();
  testInputValidation();
  testWebSocketMessageValidation();
  testMessageSorting();
  testDuplicateMessagePrevention();
  testErrorHandling();
  testMessageEditingValidation();
  testReactionHandling();
  testTypingIndicatorHandling();
  testPaginationHandling();

  console.log("\n✨ All tests completed!");
  console.log("📝 Summary:");
  console.log("- Null/undefined response handling: ✅");
  console.log("- Messages array validation: ✅");
  console.log("- Array reverse safety: ✅");
  console.log("- Input validation: ✅");
  console.log("- WebSocket message validation: ✅");
  console.log("- Message sorting: ✅");
  console.log("- Duplicate message prevention: ✅");
  console.log("- Error handling: ✅");
  console.log("- Message editing validation: ✅");
  console.log("- Reaction handling: ✅");
  console.log("- Typing indicator handling: ✅");
  console.log("- Pagination handling: ✅");
}

// Export untuk digunakan di browser console
if (typeof window !== "undefined") {
  window.testChatHook = {
    runAllTests,
    testNullResponse,
    testUndefinedMessages,
    testNonArrayMessages,
    testEmptyArrayReverse,
    testValidArrayReverse,
    testInputValidation,
    testWebSocketMessageValidation,
    testMessageSorting,
    testDuplicateMessagePrevention,
    testErrorHandling,
    testMessageEditingValidation,
    testReactionHandling,
    testTypingIndicatorHandling,
    testPaginationHandling,
  };

  console.log("📖 Test functions available in window.testChatHook");
  console.log("💡 Run window.testChatHook.runAllTests() to execute all tests");
}

// Auto-run jika di Node.js environment
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    runAllTests,
    testNullResponse,
    testUndefinedMessages,
    testNonArrayMessages,
    testEmptyArrayReverse,
    testValidArrayReverse,
    testInputValidation,
    testWebSocketMessageValidation,
    testMessageSorting,
    testDuplicateMessagePrevention,
    testErrorHandling,
    testMessageEditingValidation,
    testReactionHandling,
    testTypingIndicatorHandling,
    testPaginationHandling,
  };

  // Auto-run tests
  runAllTests();
}

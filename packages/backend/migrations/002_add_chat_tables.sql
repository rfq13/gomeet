-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    public_user_id UUID REFERENCES public_users(id) ON DELETE SET NULL,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    attachment_url VARCHAR(500),
    attachment_type VARCHAR(50),
    attachment_name VARCHAR(255),
    is_edited BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    message_status VARCHAR(20) DEFAULT 'sent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chat_messages_user_check CHECK (
        user_id IS NOT NULL OR public_user_id IS NOT NULL
    ),
    CONSTRAINT chat_messages_type_check CHECK (
        message_type IN ('text', 'image', 'file', 'system', 'reaction')
    ),
    CONSTRAINT chat_messages_status_check CHECK (
        message_status IN ('sent', 'delivered', 'read', 'failed')
    )
);

-- Create indexes for chat_messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_created
ON chat_messages(meeting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_meeting
ON chat_messages(user_id, meeting_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_public_user_meeting
ON chat_messages(public_user_id, meeting_id) WHERE public_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
ON chat_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Create chat_message_read_status table
CREATE TABLE IF NOT EXISTS chat_message_read_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    public_user_id UUID REFERENCES public_users(id) ON DELETE CASCADE,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chat_message_read_status_unique UNIQUE (message_id, user_id),
    CONSTRAINT chat_message_read_status_public_unique UNIQUE (message_id, public_user_id),
    CONSTRAINT chat_message_read_status_user_check CHECK (
        (user_id IS NOT NULL AND public_user_id IS NULL) OR
        (user_id IS NULL AND public_user_id IS NOT NULL)
    )
);

-- Create indexes for chat_message_read_status
CREATE INDEX IF NOT EXISTS idx_chat_read_status_message_user
ON chat_message_read_status(message_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_read_status_message_public_user
ON chat_message_read_status(message_id, public_user_id);

-- Create chat_message_reactions table
CREATE TABLE IF NOT EXISTS chat_message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    public_user_id UUID REFERENCES public_users(id) ON DELETE CASCADE,
    reaction VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chat_message_reactions_unique UNIQUE (message_id, user_id, reaction),
    CONSTRAINT chat_message_reactions_public_unique UNIQUE (message_id, public_user_id, reaction),
    CONSTRAINT chat_message_reactions_user_check CHECK (
        (user_id IS NOT NULL AND public_user_id IS NULL) OR
        (user_id IS NULL AND public_user_id IS NOT NULL)
    )
);

-- Create indexes for chat_message_reactions
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message_user
ON chat_message_reactions(message_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_message_public_user
ON chat_message_reactions(message_id, public_user_id);
-- Migration: Add TURN/STUN server tables
-- Description: Add tables for TURN credential management and usage tracking

-- TURN credentials table
CREATE TABLE IF NOT EXISTS turn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL UNIQUE,
    credential_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL
);

-- TURN usage logs table
CREATE TABLE IF NOT EXISTS turn_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('allocate', 'refresh', 'deallocate', 'connect', 'disconnect')),
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    bytes_transferred BIGINT DEFAULT 0,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_turn_credentials_username ON turn_credentials(username);
CREATE INDEX IF NOT EXISTS idx_turn_credentials_expires_at ON turn_credentials(expires_at);
CREATE INDEX IF NOT EXISTS idx_turn_credentials_user_id ON turn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_turn_credentials_meeting_id ON turn_credentials(meeting_id);

CREATE INDEX IF NOT EXISTS idx_turn_usage_logs_username ON turn_usage_logs(username);
CREATE INDEX IF NOT EXISTS idx_turn_usage_logs_timestamp ON turn_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_turn_usage_logs_action ON turn_usage_logs(action);
CREATE INDEX IF NOT EXISTS idx_turn_usage_logs_user_id ON turn_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_turn_usage_logs_meeting_id ON turn_usage_logs(meeting_id);

-- Add comments for documentation
COMMENT ON TABLE turn_credentials IS 'Stores TURN server credentials with expiration';
COMMENT ON TABLE turn_usage_logs IS 'Logs TURN server usage for analytics and monitoring';

COMMENT ON COLUMN turn_credentials.username IS 'TURN username in format: timestamp:uuid';
COMMENT ON COLUMN turn_credentials.credential_hash IS 'SHA1 hash of the credential password';
COMMENT ON COLUMN turn_credentials.expires_at IS 'Expiration time for the credential';
COMMENT ON COLUMN turn_usage_logs.action IS 'Type of TURN action: allocate, refresh, deallocate, connect, disconnect';
COMMENT ON COLUMN turn_usage_logs.bytes_transferred IS 'Total bytes transferred during the session';
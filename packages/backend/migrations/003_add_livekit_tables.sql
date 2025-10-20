-- Migration: Add LiveKit SFU integration tables
-- Description: Add tables for LiveKit room and participant management
-- Version: 003

-- Create LiveKit rooms table
CREATE TABLE IF NOT EXISTS livekit_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    livekit_room_id VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups by meeting_id
CREATE INDEX IF NOT EXISTS idx_livekit_rooms_meeting_id ON livekit_rooms(meeting_id);

-- Create index for faster lookups by livekit_room_id
CREATE INDEX IF NOT EXISTS idx_livekit_rooms_livekit_room_id ON livekit_rooms(livekit_room_id);

-- Create LiveKit participants table
CREATE TABLE IF NOT EXISTS livekit_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    livekit_participant_id VARCHAR(255) NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Ensure unique combination of meeting and participant
    UNIQUE(meeting_id, participant_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_livekit_participants_meeting_id ON livekit_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_livekit_participants_participant_id ON livekit_participants(participant_id);
CREATE INDEX IF NOT EXISTS idx_livekit_participants_livekit_participant_id ON livekit_participants(livekit_participant_id);
CREATE INDEX IF NOT EXISTS idx_livekit_participants_is_active ON livekit_participants(is_active);
CREATE INDEX IF NOT EXISTS idx_livekit_participants_joined_at ON livekit_participants(joined_at);

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_livekit_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_livekit_rooms_updated_at
    BEFORE UPDATE ON livekit_rooms
    FOR EACH ROW
    EXECUTE FUNCTION update_livekit_rooms_updated_at();

-- Add comments for documentation
COMMENT ON TABLE livekit_rooms IS 'Stores LiveKit room information linked to meetings';
COMMENT ON COLUMN livekit_rooms.id IS 'Primary key for the LiveKit room record';
COMMENT ON COLUMN livekit_rooms.meeting_id IS 'Foreign key to the meetings table';
COMMENT ON COLUMN livekit_rooms.livekit_room_id IS 'Unique identifier for the LiveKit room';
COMMENT ON COLUMN livekit_rooms.created_at IS 'Timestamp when the LiveKit room was created';
COMMENT ON COLUMN livekit_rooms.updated_at IS 'Timestamp when the LiveKit room was last updated';

COMMENT ON TABLE livekit_participants IS 'Stores LiveKit participant information linked to meeting participants';
COMMENT ON COLUMN livekit_participants.id IS 'Primary key for the LiveKit participant record';
COMMENT ON COLUMN livekit_participants.meeting_id IS 'Foreign key to the meetings table';
COMMENT ON COLUMN livekit_participants.participant_id IS 'Foreign key to the participants table';
COMMENT ON COLUMN livekit_participants.livekit_participant_id IS 'Unique identifier for the LiveKit participant';
COMMENT ON COLUMN livekit_participants.joined_at IS 'Timestamp when the participant joined the LiveKit room';
COMMENT ON COLUMN livekit_participants.left_at IS 'Timestamp when the participant left the LiveKit room';
COMMENT ON COLUMN livekit_participants.is_active IS 'Flag indicating if the participant is currently active in the room';

-- Create a view for active participants with meeting information
CREATE OR REPLACE VIEW active_livekit_participants AS
SELECT
    lp.id,
    lp.meeting_id,
    lp.participant_id,
    lp.livekit_participant_id,
    lp.joined_at,
    m.name as meeting_title,
    m.host_id as meeting_host_id,
    p.name as participant_name,
    p.is_active as is_meeting_host
FROM livekit_participants lp
JOIN meetings m ON lp.meeting_id = m.id
JOIN participants p ON lp.participant_id = p.id
WHERE lp.is_active = true;

COMMENT ON VIEW active_livekit_participants IS 'View of currently active LiveKit participants with meeting and user details';

-- Create a view for room statistics
CREATE OR REPLACE VIEW livekit_room_stats AS
SELECT
    lr.meeting_id,
    lr.livekit_room_id,
    lr.created_at,
    m.name as meeting_title,
    m.host_id,
    COUNT(lp.id) FILTER (WHERE lp.is_active = true) as active_participants,
    COUNT(lp.id) as total_participants,
    MAX(lp.joined_at) as last_join_time,
    CASE
        WHEN COUNT(lp.id) FILTER (WHERE lp.is_active = true) > 0 THEN true
        ELSE false
    END as is_active
FROM livekit_rooms lr
LEFT JOIN livekit_participants lp ON lr.meeting_id = lp.meeting_id
JOIN meetings m ON lr.meeting_id = m.id
GROUP BY lr.meeting_id, lr.livekit_room_id, lr.created_at, m.name, m.host_id;

COMMENT ON VIEW livekit_room_stats IS 'View of LiveKit room statistics including participant counts';

-- Add function to clean up inactive participants older than specified hours
CREATE OR REPLACE FUNCTION cleanup_inactive_livekit_participants(hours_old INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    cleanup_count INTEGER;
BEGIN
    -- Update participants that have been inactive for more than specified hours
    UPDATE livekit_participants 
    SET is_active = false, left_at = NOW()
    WHERE is_active = true 
    AND joined_at < NOW() - INTERVAL '1 hour' * hours_old;
    
    GET DIAGNOSTICS cleanup_count = ROW_COUNT;
    
    -- Log the cleanup action using RAISE NOTICE instead of system_logs table
    RAISE NOTICE 'Cleaned up % inactive LiveKit participants older than % hours', cleanup_count, hours_old;
    
    RETURN cleanup_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get participant count for a meeting
CREATE OR REPLACE FUNCTION get_livekit_participant_count(meeting_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    participant_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO participant_count
    FROM livekit_participants 
    WHERE meeting_id = meeting_uuid AND is_active = true;
    
    RETURN COALESCE(participant_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Create a function to check if a LiveKit room exists for a meeting
CREATE OR REPLACE FUNCTION livekit_room_exists(meeting_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    room_exists BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT 1 FROM livekit_rooms WHERE meeting_id = meeting_uuid) INTO room_exists;
    
    RETURN COALESCE(room_exists, false);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically create LiveKit room when meeting starts
-- This can be enabled/disabled based on configuration
CREATE OR REPLACE FUNCTION auto_create_livekit_room()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create LiveKit room if meeting is being activated and doesn't already exist
    IF NEW.is_active = true AND OLD.is_active = false THEN
        INSERT INTO livekit_rooms (meeting_id, livekit_room_id)
        VALUES (NEW.id, 'meeting_' || NEW.id::text)
        ON CONFLICT (meeting_id) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Uncomment the following line to enable automatic LiveKit room creation
-- CREATE TRIGGER trigger_auto_create_livekit_room
--     AFTER UPDATE ON meetings
--     FOR EACH ROW
--     WHEN (OLD.is_active = false AND NEW.is_active = true)
--     EXECUTE FUNCTION auto_create_livekit_room();
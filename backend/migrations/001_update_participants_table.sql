-- Update participants table to allow null values in user_id and public_user_id
-- This migration allows public users to join meetings without authentication

-- First, drop the existing constraints if they exist
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_user_id_fkey;
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_public_user_id_fkey;

-- Alter columns to allow NULL values
ALTER TABLE participants ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE participants ALTER COLUMN public_user_id DROP NOT NULL;

-- Re-add foreign key constraints with ON DELETE SET NULL
ALTER TABLE participants ADD CONSTRAINT participants_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE participants ADD CONSTRAINT participants_public_user_id_fkey 
    FOREIGN KEY (public_user_id) REFERENCES public_users(id) ON DELETE SET NULL;

-- Add check constraint to ensure either user_id or public_user_id is set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'participants_user_check'
        AND table_name = 'participants'
    ) THEN
        ALTER TABLE participants ADD CONSTRAINT participants_user_check
            CHECK (user_id IS NOT NULL OR public_user_id IS NOT NULL);
    END IF;
END $$;
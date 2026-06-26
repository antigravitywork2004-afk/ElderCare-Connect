-- Notification System Enhancement
-- Extends parent_notifications to support typed notifications with rich metadata

-- Add notification_type column (TEXT for flexibility, mirrors existing 'type' column)
ALTER TABLE public.parent_notifications
  ADD COLUMN IF NOT EXISTS notification_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add index for fast unread count queries per recipient
CREATE INDEX IF NOT EXISTS idx_parent_notifications_recipient_read
  ON public.parent_notifications(parent_id, is_read);

-- Add index for type-based filtering
CREATE INDEX IF NOT EXISTS idx_parent_notifications_type
  ON public.parent_notifications(notification_type);

-- Add index for deduplication checks (metadata-based)
CREATE INDEX IF NOT EXISTS idx_parent_notifications_created_at
  ON public.parent_notifications(parent_id, created_at DESC);

-- Allow children to see notifications addressed to them
-- (parent_id stores the recipient's ID, which can be a child's ID)
-- The existing policy already covers: parent_id = auth.uid() OR sender_id = auth.uid()
-- So child-targeted notifications (parent_id = child.id) are already visible to them.

-- Grant realtime access so the bell badge updates live
ALTER PUBLICATION supabase_realtime ADD TABLE public.parent_notifications;

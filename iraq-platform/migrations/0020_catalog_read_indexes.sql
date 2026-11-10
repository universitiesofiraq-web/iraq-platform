-- Index parent lookups without changing existing academic data.
CREATE INDEX IF NOT EXISTS idx_departments_college ON departments(college_id);
CREATE INDEX IF NOT EXISTS idx_lectures_subject ON lectures(subject_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(group_id, id, sender_id)
  WHERE deleted_at IS NULL;

-- فهارس تمنع مسح الجداول كاملة (حصة قراءة D1 اليومية)
CREATE INDEX IF NOT EXISTS idx_stages_department ON stages(department_id);
CREATE INDEX IF NOT EXISTS idx_terms_stage ON terms(stage_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_college ON user_profile(college_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_stage ON user_profile(stage_id);
CREATE INDEX IF NOT EXISTS idx_scopes_type_node ON scopes(type, node_id);

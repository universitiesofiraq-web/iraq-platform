-- شعار كل كلية (صورة مصغّرة JPEG/PNG تُرفع من مركز الرفع). عام للقراءة.
CREATE TABLE IF NOT EXISTS college_logos (
  college_id INTEGER PRIMARY KEY REFERENCES colleges(id),
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL
);

-- شعار كل جامعة (صورة مصغّرة PNG/JPEG/WebP). عام للقراءة، ويرفعه المشرف أو ممثل الجامعة.
CREATE TABLE IF NOT EXISTS university_logos (
  university_id INTEGER PRIMARY KEY REFERENCES universities(id),
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_by INTEGER,
  updated_at INTEGER NOT NULL
);

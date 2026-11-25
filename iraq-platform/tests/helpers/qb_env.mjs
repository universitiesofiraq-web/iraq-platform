// بيئة اختبار بنك الأسئلة: قاعدة SQLite محلية بكل ترحيلات المنصة + ترحيل qb، ومستخدمون بأدوار مختلفة.
import { createHash } from "node:crypto";
import { database } from "./d1.mjs";
import { handleQb } from "../../functions/_lib/qb.js";
import { currentUser } from "../../functions/_lib/auth.js";
import { ensureQbSchema, resetQbSchemaState } from "../../functions/_lib/qb_schema.js";

export async function makeEnv() {
  resetQbSchemaState();
  const { DB, sql } = database();
  const env = { DB, QB_ENABLED: "1", QB_MIGRATE: "1", ADMIN_EMAILS: "root@example.test" };
  await ensureQbSchema(env);
  const now = Date.now();
  const user = (name, email, role = "student") => Number(sql.prepare("INSERT INTO users (google_sub, email, name, role, active, created_at) VALUES (?,?,?,?,1,?)").run("sub-" + name, email, name, role, now).lastInsertRowid);
  const ids = { root: user("root", "root@example.test", "admin"), rep: user("rep", "rep@example.test"), up: user("up", "up@example.test"), st: user("st", "st@example.test"), st2: user("st2", "st2@example.test"), other: user("other", "other@example.test") };
  sql.exec("INSERT INTO universities (id, slug, name_ar, is_active) VALUES (1,'u1','جامعة',1),(2,'u2','جامعة ثانية',1)");
  sql.exec("INSERT INTO colleges (id, university_id, slug, name_ar, is_active) VALUES (1,1,'c1','كلية',1),(2,2,'c2','كلية ثانية',1)");
  sql.exec("INSERT INTO departments (id, college_id, name_ar) VALUES (1,1,'قسم'),(2,2,'قسم ثانٍ')");
  sql.exec("INSERT INTO stages (id, department_id, number) VALUES (1,1,3),(2,2,3)");
  sql.exec("INSERT INTO terms (id, stage_id, number) VALUES (1,1,1),(2,2,1)");
  sql.exec("INSERT INTO subjects (id, term_id, name_ar, name_en) VALUES (1,1,'التشريح','Anatomy'),(2,2,'الأدوية','Pharma')");
  sql.exec("INSERT INTO lectures (id, subject_id, number, title) VALUES (1,1,1,'القلب'),(2,1,2,'الرئة'),(3,2,1,'مضادات')");
  sql.prepare("INSERT INTO scopes (user_id, type, node_id, level) VALUES (?,?,?,?)").run(ids.rep, "department", 1, "rep");
  sql.prepare("INSERT INTO scopes (user_id, type, node_id, level) VALUES (?,?,?,?)").run(ids.up, "department", 1, "uploader");
  const cookies = {};
  const cookieOf = (uid) => cookies[uid] ||= (() => { const c = uid.toString(16).padStart(64, "0"); sql.prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?)").run(createHash("sha256").update(c).digest("hex"), uid, Date.now() + 3600_000); return c; })();
  const clock = { now };
  async function call(uid, method, path, body, { origin = "https://example.test", headers = {} } = {}) {
    const h = { ...headers };
    if (uid) h.cookie = "ms_session=" + cookieOf(uid);
    if (method !== "GET") h.origin = origin;
    if (body !== undefined) h["content-type"] = "application/json";
    const req = new Request("https://example.test/api/qb/" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await handleQb(req, env, { currentUser, now: () => clock.now });
    if (!res) return { status: 0, body: null };
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, body: data };
  }
  return { env, sql, ids, call, clock };
}

export const sba = (text = "ما أكبر عضلة؟", extra = {}) => ({ text, points: 1, options: [{ id: "a", text: "القلب" }, { id: "b", text: "الكبد" }, { id: "c", text: "الرئة" }], correct: "a", explanation: "شرح", ...extra });

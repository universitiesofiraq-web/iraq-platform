import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const migrations = new URL("../../migrations/", import.meta.url);

export function database(through = Infinity) {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(migrations).filter(n => n.endsWith(".sql")).sort()) {
    if (Number(name.split("_")[0]) <= through) sql.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const DB = {
    prepare(query) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() { return this.execute(); },
        execute() {
          const result = sql.prepare(query).run(...args);
          return { meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        }
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map(statement => statement.execute());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { DB, sql };
}

export function signedRequest(sql, pathname, userId, body, origin = "https://example.test") {
  const headers = {};
  if (userId) {
    const cookie = userId.toString(16).padStart(64, "0");
    const hash = createHash("sha256").update(cookie).digest("hex");
    sql.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)").run(hash, userId, Date.now() + 60_000);
    headers.cookie = "ms_session=" + cookie;
  }
  if (body !== undefined) {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  return new Request("https://example.test" + pathname, {
    headers,
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export function seedAcademic(sql) {
  sql.exec(`
    INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES
      (1,'1','owner@example.test','المالك','student',1,0),
      (2,'2','manager@example.test','المسؤول','student',1,0),
      (3,'3','student@example.test','الطالب','admin',1,0),
      (4,'4','inactive@example.test','حساب معطل','student',0,0);
    INSERT INTO universities (id,slug,name_ar,is_active) VALUES (1,'u1','جامعة الدليل',1),(2,'u2','جامعة ثانية',1);
    INSERT INTO colleges (id,university_id,slug,name_ar,is_active) VALUES (1,1,'c1','كلية أولى',1),(2,2,'c2','كلية ثانية',1);
    INSERT INTO departments (id,college_id,name_ar) VALUES (1,1,'قسم أول'),(2,2,'قسم ثان');
    INSERT INTO stages (id,department_id,number) VALUES (11,1,1),(12,1,2),(21,2,1);
    INSERT INTO terms (id,stage_id,number) VALUES (11,11,1),(12,12,1),(21,21,1);
    INSERT INTO subjects (id,term_id,name_ar) VALUES (11,11,'مادة أولى'),(12,12,'مادة ثانية'),(21,21,'مادة خارجية');
    INSERT INTO scopes (user_id,type,node_id,level) VALUES (2,'university',1,'rep'),(4,'university',2,'rep');
  `);
}

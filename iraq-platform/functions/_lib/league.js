import { currentUser } from './auth.js';
import { policy } from './scope.js';
import { serviceErrorResponse } from './service-errors.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Cookie'
} });
const fail = (error, status = 400) => json({ ok: false, error }, status);
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const id = value => Number.isSafeInteger(value) && value > 0;
const scores = `SELECT m.*,COALESCE(SUM(l.delta),0) AS points FROM league_members m
 LEFT JOIN league_ledger l ON l.season_id=m.season_id AND l.user_id=m.user_id
 WHERE m.season_id=? GROUP BY m.user_id`;

export async function handleLeague(req, env, { now = Date.now } = {}) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/league/')) return null;
  if (!env.DB) return fail('not_configured', 503);
  try {
    const user = await currentUser(req, env);
    if (!user) return fail('unauthorized', 401);
    const permissions = await policy(env, user);
    const db = env.DB;
    const time = now();
    const action = url.pathname.slice('/api/league/'.length);
    if (req.method === 'GET' && action === 'overview') {
      const hall = (await db.prepare(`WITH totals AS (
        SELECT s.id AS season_id,s.title,m.user_id,m.display_name,COALESCE(SUM(l.delta),0) AS points
        FROM league_seasons s JOIN league_members m ON m.season_id=s.id
        LEFT JOIN league_ledger l ON l.season_id=m.season_id AND l.user_id=m.user_id
        WHERE s.state='closed' AND m.public=1 GROUP BY s.id,m.user_id
      ), ranked AS (SELECT *,RANK() OVER(PARTITION BY season_id ORDER BY points DESC) AS rank FROM totals)
      SELECT season_id,title,display_name,points,rank FROM ranked WHERE rank<=3 AND points>0
      ORDER BY season_id DESC,rank,user_id LIMIT 100`).all()).results;
      const seasons = (await db.prepare(`SELECT * FROM league_seasons ORDER BY id DESC LIMIT 24`).all()).results;
      const requested = url.searchParams.get('season');
      if (requested && !id(Number(requested))) return fail('bad_request');
      const season = requested ? await db.prepare('SELECT * FROM league_seasons WHERE id=?').bind(Number(requested)).first() : seasons.find(s => s.state === 'active') || seasons[0];
      if (requested && !season) return fail('not_found',404);
      if (season && !seasons.some(s => s.id===season.id)) seasons.push(season);
      if (!season) return json({ ok: true, admin: permissions.admin, seasons, season: null });
      const member = await db.prepare('SELECT * FROM league_members WHERE season_id=? AND user_id=?').bind(season.id, user.id).first();
      const stages = permissions.admin ? (await db.prepare(`SELECT st.id,st.number,d.name_ar AS department,c.name_ar AS college,u.name_ar AS university
        FROM stages st JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
        JOIN universities u ON u.id=c.university_id JOIN university_onboarding o ON o.university_id=u.id
        WHERE o.state='active' ORDER BY u.name_ar,c.name_ar,d.name_ar,st.number`).all()).results : [];
      const challenges = (await db.prepare(`SELECT c.*,sub.id AS submission_id,sub.state AS submission_state,sub.review_reason,a.state AS appeal_state,cs.stage_id AS target_stage
        FROM league_challenges c LEFT JOIN league_submissions sub ON sub.challenge_id=c.id AND sub.user_id=?
        LEFT JOIN league_appeals a ON a.submission_id=sub.id LEFT JOIN league_challenge_stages cs ON cs.challenge_id=c.id
        WHERE c.season_id=? AND (?=1 OR cs.stage_id IS NULL OR cs.stage_id=?) ORDER BY c.id`).bind(user.id, season.id,Number(permissions.admin),member?.stage_id || 0).all()).results;
      const me = await db.prepare(`SELECT * FROM (${scores}) WHERE user_id=?`).bind(season.id, user.id).first();
      const ranking = (await db.prepare(`WITH scores AS (${scores})
        SELECT display_name,points,RANK() OVER(ORDER BY points DESC) AS rank,user_id=? AS mine
        FROM scores WHERE public=1 ORDER BY points DESC,user_id LIMIT 100`).bind(season.id, user.id).all()).results;
      const groups = (await db.prepare(`WITH scores AS (${scores}), groups AS (
        SELECT stage_id,COUNT(*) AS members,SUM(points>0) AS participants,
        ROUND(AVG(MIN(points,100)),2) AS score FROM scores GROUP BY stage_id)
        SELECT g.*,st.number AS stage,d.name_ar AS department,c.name_ar AS college,u.name_ar AS university,
        RANK() OVER(ORDER BY score DESC) AS rank FROM groups g JOIN stages st ON st.id=g.stage_id
        JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
        JOIN universities u ON u.id=c.university_id ORDER BY score DESC,g.stage_id LIMIT 100`).bind(season.id).all()).results;
      const myGroup = member ? await db.prepare(`WITH scores AS (${scores}), grouped AS (
        SELECT stage_id,COUNT(*) AS members,SUM(points>0) AS participants,ROUND(AVG(MIN(points,100)),2) AS score
        FROM scores GROUP BY stage_id), ranked AS (SELECT *,RANK() OVER(ORDER BY score DESC) AS rank FROM grouped)
        SELECT * FROM ranked WHERE stage_id=?`).bind(season.id,member.stage_id).first() : null;
      const groupChallenges = member ? (await db.prepare(`SELECT c.id,c.title,c.points,
        COUNT(m.user_id) AS members,SUM(sub.state='approved') AS completed
        FROM league_challenges c JOIN league_members m ON m.season_id=c.season_id AND m.stage_id=?
        LEFT JOIN league_challenge_stages cs ON cs.challenge_id=c.id
        LEFT JOIN league_submissions sub ON sub.challenge_id=c.id AND sub.user_id=m.user_id
        WHERE c.season_id=? AND (cs.stage_id IS NULL OR cs.stage_id=m.stage_id) GROUP BY c.id ORDER BY c.id`)
        .bind(member.stage_id,season.id).all()).results : [];
      const lifetime = await db.prepare(`SELECT COALESCE(SUM(delta),0) AS points,COUNT(DISTINCT season_id) AS seasons FROM league_ledger WHERE user_id=?`).bind(user.id).first();
      const myRank = member?.public ? await db.prepare(`WITH scores AS (${scores}), ranked AS (
        SELECT user_id,RANK() OVER(ORDER BY points DESC) AS rank FROM scores WHERE public=1)
        SELECT rank FROM ranked WHERE user_id=?`).bind(season.id,user.id).first() : null;
      const history = (await db.prepare(`SELECT h.*,c.title FROM league_review_history h
        JOIN league_submissions sub ON sub.id=h.submission_id JOIN league_challenges c ON c.id=sub.challenge_id
        WHERE sub.user_id=? AND c.season_id=? ORDER BY h.id DESC LIMIT 100`).bind(user.id,season.id).all()).results;
      const ledger = (await db.prepare(`SELECT delta,reason,created_at FROM league_ledger
        WHERE season_id=? AND user_id=? ORDER BY id DESC LIMIT 100`).bind(season.id,user.id).all()).results;
      return json({ ok: true, admin: permissions.admin, reviewer: permissions.admin || permissions.scopes.some(s => s.level === 'rep'),
        seasons, season, member, me, stages, hall, challenges, ranking, groups, myGroup, groupChallenges, ledger, lifetime, myRank, history });
    }
    if (req.method === 'GET' && action === 'review') {
      if (!permissions.admin && !permissions.scopes.some(s => s.level === 'rep')) return fail('forbidden',403);
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) return fail('bad_request');
      const state = url.searchParams.get('state') || 'pending';
      if (!['pending','approved','rejected','appeals','all'].includes(state)) return fail('bad_request');
      const candidates = (await db.prepare(`SELECT sub.*,c.title,c.points,c.season_id,m.stage_id,m.display_name,
        a.reason AS appeal_reason,a.state AS appeal_state
        FROM league_submissions sub JOIN league_challenges c ON c.id=sub.challenge_id
        JOIN league_seasons s ON s.id=c.season_id
        JOIN league_members m ON m.season_id=c.season_id AND m.user_id=sub.user_id
        JOIN stages st ON st.id=m.stage_id JOIN departments d ON d.id=st.department_id
        JOIN colleges col ON col.id=d.college_id
        LEFT JOIN league_appeals a ON a.submission_id=sub.id
        WHERE s.state='active' AND sub.id>? AND sub.user_id!=?
        AND (?='all' OR (?='appeals' AND a.state='pending') OR sub.state=?)
        AND (?=1 OR EXISTS(SELECT 1 FROM scopes sc WHERE sc.user_id=? AND sc.level='rep' AND (
          (sc.type='stage' AND sc.node_id=st.id) OR (sc.type='department' AND sc.node_id=d.id)
          OR (sc.type='college' AND sc.node_id=col.id) OR (sc.type='university' AND sc.node_id=col.university_id))))
        ORDER BY sub.id LIMIT 101`).bind(after,user.id,state,state,state,Number(permissions.admin),user.id).all()).results;
      const items = candidates.slice(0,100);
      return json({ ok: true, items, next: candidates.length>100 ? items.at(-1).id : null });
    }
    if (req.method !== 'POST') return fail('not_found', 404);
    if (req.headers.get('origin') !== url.origin || !req.headers.get('content-type')?.includes('application/json')) return fail('forbidden',403);
    const raw = await req.text();
    if (raw.length > 12000) return fail('too_large',413);
    let b;
    try { b = JSON.parse(raw); } catch { return fail('bad_request'); }
    if (!b || typeof b !== 'object') return fail('bad_request');
    if (action === 'season') {
      if (!permissions.admin) return fail('forbidden',403);
      const title = text(b.title,100);
      if (!title || !id(b.starts_at) || !id(b.ends_at) || b.ends_at <= b.starts_at || b.ends_at <= time) return fail('bad_request');
      const result = await db.prepare(`INSERT INTO league_seasons(title,starts_at,ends_at,created_by,created_at) VALUES(?,?,?,?,?)`)
        .bind(title,b.starts_at,b.ends_at,user.id,time).run();
      return json({ ok: true, id: result.meta.last_row_id });
    }
    if (action === 'challenge') {
      if (!permissions.admin) return fail('forbidden',403);
      if (!id(b.season_id) || !text(b.title,100) || !text(b.description,2000) || !id(b.points) || b.points > 100 || !id(b.deadline)) return fail('bad_request');
      if (b.stage_id != null) {
        if (!id(b.stage_id)) return fail('bad_request');
        const target = await db.prepare(`SELECT st.id FROM stages st JOIN departments d ON d.id=st.department_id
          JOIN colleges c ON c.id=d.college_id JOIN university_onboarding o ON o.university_id=c.university_id
          WHERE st.id=? AND o.state='active'`).bind(b.stage_id).first();
        if (!target) return fail('bad_request');
      }
      const insert = db.prepare(`INSERT INTO league_challenges(season_id,title,description,points,deadline,created_by)
        SELECT id,?,?,?,?,? FROM league_seasons WHERE id=? AND state='draft' AND ? BETWEEN starts_at AND ends_at`)
        .bind(b.title.trim(),b.description.trim(),b.points,b.deadline,user.id,b.season_id,b.deadline);
      const results = await db.batch([insert,...(b.stage_id == null ? [] : [db.prepare(`INSERT INTO league_challenge_stages(challenge_id,stage_id)
        SELECT last_insert_rowid(),? WHERE changes()>0`).bind(b.stage_id)])]);
      const result = results[0];
      return result.meta.changes ? json({ ok: true }) : fail('season_locked',409);
    }
    if (action === 'season-state') {
      if (!permissions.admin) return fail('forbidden',403);
      if (!id(b.season_id) || !['active','closed'].includes(b.state)) return fail('bad_request');
      const prior = b.state === 'active' ? 'draft' : 'active';
      const result = await db.prepare(`UPDATE league_seasons SET state=? WHERE id=? AND state=?
        AND (?='closed' OR (ends_at>? AND EXISTS(SELECT 1 FROM league_challenges WHERE season_id=league_seasons.id)))
        AND (?='active' OR (ends_at<=? AND NOT EXISTS(SELECT 1 FROM league_submissions sub JOIN league_challenges c ON c.id=sub.challenge_id WHERE c.season_id=league_seasons.id AND (sub.state='pending' OR EXISTS(SELECT 1 FROM league_appeals a WHERE a.submission_id=sub.id AND a.state='pending')))))`)
        .bind(b.state,b.season_id,prior,b.state,time,b.state,time).run();
      return result.meta.changes ? json({ ok: true }) : fail('season_locked',409);
    }
    if (action === 'join') {
      if (!id(b.season_id) || !text(b.display_name,40) || typeof b.public !== 'boolean') return fail('bad_request');
      const result = await db.prepare(`INSERT INTO league_members(season_id,user_id,stage_id,display_name,public,joined_at)
        SELECT s.id,p.user_id,p.stage_id,?,?,? FROM league_seasons s JOIN user_profile p ON p.user_id=?
        JOIN stages st ON st.id=p.stage_id JOIN departments d ON d.id=st.department_id
        JOIN colleges c ON c.id=d.college_id JOIN university_onboarding u ON u.university_id=c.university_id
        WHERE s.id=? AND s.state='active' AND ? BETWEEN s.starts_at AND s.ends_at AND u.state='active'
        ON CONFLICT(season_id,user_id) DO UPDATE SET display_name=excluded.display_name,public=excluded.public`)
        .bind(b.display_name.trim(),Number(b.public),time,user.id,b.season_id,time).run();
      return result.meta.changes ? json({ ok: true }) : fail('membership_unavailable',409);
    }
    if (action === 'privacy') {
      if (!id(b.season_id) || typeof b.public !== 'boolean') return fail('bad_request');
      await db.prepare('UPDATE league_members SET public=? WHERE season_id=? AND user_id=?').bind(Number(b.public),b.season_id,user.id).run();
      return json({ ok: true });
    }
    if (action === 'submit') {
      if (!id(b.challenge_id) || !text(b.evidence,2000)) return fail('bad_request');
      const result = await db.prepare(`INSERT OR IGNORE INTO league_submissions(challenge_id,user_id,evidence,submitted_at)
        SELECT c.id,m.user_id,?,? FROM league_challenges c JOIN league_seasons s ON s.id=c.season_id
        JOIN league_members m ON m.season_id=s.id AND m.user_id=?
        JOIN user_profile p ON p.user_id=m.user_id AND p.stage_id=m.stage_id
        WHERE c.id=? AND NOT EXISTS(SELECT 1 FROM league_challenge_stages cs WHERE cs.challenge_id=c.id AND cs.stage_id!=m.stage_id) AND s.state='active' AND ? BETWEEN s.starts_at AND MIN(c.deadline,s.ends_at)`)
        .bind(b.evidence.trim(),time,user.id,b.challenge_id,time).run();
      return result.meta.changes ? json({ ok: true }) : fail('submission_unavailable',409);
    }
    if (action === 'appeal') {
      if (!id(b.submission_id) || !text(b.reason,1000)) return fail('bad_request');
      const result = await db.prepare(`INSERT OR IGNORE INTO league_appeals(submission_id,reason,created_at)
        SELECT sub.id,?,? FROM league_submissions sub JOIN league_challenges c ON c.id=sub.challenge_id
        JOIN league_seasons s ON s.id=c.season_id
        WHERE sub.id=? AND sub.user_id=? AND sub.state='rejected' AND s.state='active'`)
        .bind(b.reason.trim(),time,b.submission_id,user.id).run();
      return result.meta.changes ? json({ok:true}) : fail('appeal_unavailable',409);
    }
    if (action === 'decision') {
      if (!id(b.submission_id) || !['approved','rejected'].includes(b.state) || !text(b.reason,500)) return fail('bad_request');
      const row = await db.prepare(`SELECT sub.*,c.season_id,c.points,m.stage_id FROM league_submissions sub
        JOIN league_challenges c ON c.id=sub.challenge_id JOIN league_members m ON m.season_id=c.season_id AND m.user_id=sub.user_id WHERE sub.id=?`)
        .bind(b.submission_id).first();
      if (!row) return fail('not_found',404);
      if (row.user_id === user.id || !(await permissions.manage('stage',row.stage_id))) return fail('forbidden',403);
      const appeal = await db.prepare("SELECT * FROM league_appeals WHERE submission_id=? AND state='pending'").bind(row.id).first();
      if (appeal && row.reviewed_by === user.id) return fail('independent_review_required',403);
      // The adjustment derives from the current ledger inside the same atomic D1 batch.
      // Retries and concurrent decisions converge on one balance per submission.
      await db.batch([
        db.prepare(`INSERT INTO league_ledger(submission_id,season_id,user_id,delta,reason,actor_id,created_at)
          SELECT ?,?,?,? - COALESCE((SELECT SUM(delta) FROM league_ledger WHERE submission_id=?),0),?,?,?
          WHERE EXISTS(SELECT 1 FROM league_seasons WHERE id=? AND state='active')
          AND ? != COALESCE((SELECT SUM(delta) FROM league_ledger WHERE submission_id=?),0)`)
          .bind(row.id,row.season_id,row.user_id,b.state === 'approved' ? row.points : 0,row.id,b.reason.trim(),user.id,time,row.season_id,b.state === 'approved' ? row.points : 0,row.id),
        db.prepare('UPDATE league_submissions SET state=?,review_reason=?,reviewed_by=?,reviewed_at=? WHERE id=?').bind(b.state,b.reason.trim(),user.id,time,row.id),
        db.prepare("UPDATE league_appeals SET state='resolved',resolved_at=? WHERE submission_id=? AND state='pending'").bind(time,row.id)
      ]);
      return json({ ok: true });
    }
    return fail('not_found',404);
  } catch (error) {
    if (/independent_review_required/.test(String(error?.message))) return fail('independent_review_required',403);
    if (/season_locked|UNIQUE constraint/.test(String(error?.message))) return fail('season_locked',409);
    return serviceErrorResponse(error);
  }
}

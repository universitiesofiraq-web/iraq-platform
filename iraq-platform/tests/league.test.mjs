import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedAcademic, signedRequest } from './helpers/d1.mjs';
import { handleLeague } from '../functions/_lib/league.js';

function fixture() {
 const {DB,sql}=database();seedAcademic(sql);
 const env={DB,ADMIN_EMAILS:'owner@example.test'};
 sql.exec(`INSERT OR REPLACE INTO user_profile(user_id,college_id,stage_id) VALUES(2,1,11),(3,1,11);
 INSERT INTO university_onboarding(university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES(1,'active',1,0,0,1);
 DELETE FROM scopes WHERE user_id=2; INSERT INTO scopes(user_id,type,node_id,level) VALUES(2,'stage',11,'rep');`);
 let time=Date.now();
 const call=(user,action,body)=>handleLeague(signedRequest(sql,'/api/league/'+action,user,body),env,{now:()=>time});
 return {DB,sql,call,setTime:t=>time=t,time};
}
async function setup(f){
 assert.equal((await f.call(1,'season',{title:'موسم تجريبي',starts_at:f.time-1000,ends_at:f.time+60000})).status,200);
 assert.equal((await f.call(1,'challenge',{season_id:1,title:'ملخص',description:'شرح موثق',points:20,deadline:f.time+50000})).status,200);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'active'})).status,200);
 assert.equal((await f.call(3,'join',{season_id:1,display_name:'طالب',public:true})).status,200);
 assert.equal((await f.call(3,'submit',{challenge_id:1,evidence:'أنجزت الملخص'})).status,200);
}
test('league requires authentication and authoritative admin permissions',async()=>{
 const f=fixture();assert.equal((await f.call(null,'overview')).status,401);
 assert.equal((await f.call(3,'season',{title:'x',starts_at:f.time,ends_at:f.time+1})).status,403);
});
test('approval retries, reversals and frozen season keep a consistent ledger',async()=>{
 const f=fixture();await setup(f);
 const decide=state=>f.call(2,'decision',{submission_id:1,state,reason:'مراجعة المحتوى'});
 assert.equal((await decide('approved')).status,200);
 assert.equal((await decide('approved')).status,200);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n,SUM(delta) points FROM league_ledger').get().points,20);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM league_ledger').get().n,1);
 assert.equal((await decide('rejected')).status,200);
 assert.equal(f.sql.prepare('SELECT SUM(delta) n FROM league_ledger').get().n,0);
 assert.equal((await decide('approved')).status,200);
 f.setTime(f.time+70000);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'closed'})).status,200);
 assert.equal((await decide('rejected')).status,409);
 assert.equal(f.sql.prepare('SELECT SUM(delta) n FROM league_ledger').get().n,20);
});
test('scope forgery, duplicate submission, changed membership and private ranking',async()=>{
 const f=fixture();await setup(f);
 assert.equal((await f.call(3,'submit',{challenge_id:1,evidence:'duplicate'})).status,409);
 assert.equal((await f.call(3,'decision',{submission_id:1,state:'approved',reason:'self'})).status,403);
 f.sql.exec("UPDATE scopes SET node_id=2 WHERE user_id=2 AND type='stage'");
 assert.equal((await f.call(2,'decision',{submission_id:1,state:'approved',reason:'outside'})).status,403);
 let overview=await (await f.call(3,'overview')).json();assert.equal(overview.ranking.length,1);assert.equal(overview.groups.length,1);
 assert.equal((await f.call(3,'privacy',{season_id:1,public:false})).status,200);
 overview=await (await f.call(3,'overview')).json();assert.equal(overview.ranking.length,0);assert.equal(overview.groups.length,1);
 assert.equal((await f.call(1,'challenge',{season_id:1,title:'x',description:'x',points:100,deadline:f.time+100})).status,409);
});
test('closing requires time expiry and resolved reviews; foreign origins are rejected',async()=>{
 const f=fixture();await setup(f);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'closed'})).status,409);
 f.setTime(f.time+70000);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'closed'})).status,409);
 const request=signedRequest(f.sql,'/api/league/privacy',3,{season_id:1,public:true});
 request.headers.set('origin','https://evil.test');
 assert.equal((await handleLeague(request,{DB:f.DB})).status,403);
});
test('account deletion hides names and evidence without changing earned group points',async()=>{
 const f=fixture();await setup(f);
 await f.call(2,'decision',{submission_id:1,state:'approved',reason:'معتمد'});
 f.sql.exec("UPDATE users SET google_sub='deleted-3',active=0 WHERE id=3");
 assert.equal(f.sql.prepare('SELECT public FROM league_members WHERE user_id=3').get().public,0);
 assert.equal(f.sql.prepare('SELECT evidence FROM league_submissions WHERE user_id=3').get().evidence,'');
 assert.equal(f.sql.prepare('SELECT SUM(delta) points FROM league_ledger').get().points,20);
});
test('changing stage cannot move an existing season membership or submit to it',async()=>{
 const f=fixture();await setup(f);
 f.sql.exec('UPDATE user_profile SET stage_id=12 WHERE user_id=3');
 await f.call(3,'join',{season_id:1,display_name:'طالب',public:true});
 assert.equal(f.sql.prepare('SELECT stage_id FROM league_members WHERE user_id=3').get().stage_id,11);
 assert.equal((await f.call(3,'submit',{challenge_id:1,evidence:'تغيير المرحلة'})).status,409);
});
test('appeals are private, unique, independently reviewed and block season closure',async()=>{
 const f=fixture();await setup(f);
 await f.call(2,'decision',{submission_id:1,state:'rejected',reason:'الدليل غير كافٍ'});
 assert.equal((await f.call(2,'appeal',{submission_id:1,reason:'ليس صاحب المشاركة'})).status,409);
 assert.equal((await f.call(3,'appeal',{submission_id:1,reason:'أرفقت الشرح الكامل'})).status,200);
 assert.equal((await f.call(3,'appeal',{submission_id:1,reason:'إعادة'})).status,409);
 assert.equal((await f.call(2,'decision',{submission_id:1,state:'approved',reason:'مراجعة اعتراضي'})).status,403);
 f.setTime(f.time+70000);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'closed'})).status,409);
 assert.equal((await f.call(1,'decision',{submission_id:1,state:'approved',reason:'قبول الاعتراض'})).status,200);
 const view=await (await f.call(3,'overview')).json();
 assert.equal(view.challenges[0].appeal_state,'resolved');
 assert.equal(view.history.length,2);assert.equal(view.lifetime.points,20);assert.equal(view.myRank.rank,1);
 assert.equal((await f.call(1,'season-state',{season_id:1,state:'closed'})).status,200);
 assert.equal((await f.call(3,'appeal',{submission_id:1,reason:'مغلق'})).status,409);
});
test('private lifetime and review history are never returned for another student',async()=>{
 const f=fixture();await setup(f);
 await f.call(2,'decision',{submission_id:1,state:'approved',reason:'اعتماد'});
 const view=await (await f.call(2,'overview')).json();
 assert.equal(view.history.length,0);assert.equal(view.lifetime.points,0);assert.equal(view.myRank,null);
});
test('stage challenges are hidden and rejected outside the assigned stage',async()=>{
 const f=fixture();
 await f.call(1,'season',{title:'تحديات المراحل',starts_at:f.time-1000,ends_at:f.time+60000});
 assert.equal((await f.call(1,'challenge',{season_id:1,title:'تحدي المرحلة الثانية',description:'إنجاز دراسي',points:40,deadline:f.time+50000,stage_id:12})).status,200);
 assert.equal((await f.call(1,'challenge',{season_id:1,title:'غير صالح',description:'إنجاز',points:40,deadline:f.time+50000,stage_id:999})).status,400);
 await f.call(1,'season-state',{season_id:1,state:'active'});
 await f.call(3,'join',{season_id:1,display_name:'طالب أولى',public:false});
 assert.equal((await (await f.call(3,'overview')).json()).challenges.length,0);
 assert.equal((await f.call(3,'submit',{challenge_id:1,evidence:'تزوير النطاق'})).status,409);
 f.sql.exec('UPDATE user_profile SET stage_id=12 WHERE user_id=2');
 await f.call(2,'join',{season_id:1,display_name:'طالب ثانية',public:true});
 assert.equal((await (await f.call(2,'overview')).json()).challenges.length,1);
 assert.equal((await f.call(2,'submit',{challenge_id:1,evidence:'إنجاز صحيح'})).status,200);
 assert.throws(()=>f.sql.exec('DELETE FROM league_challenge_stages'),/season_locked/);
});
test('review queue applies stage scope and state filters before pagination',async()=>{
 const f=fixture();await setup(f);
 let result=await f.call(2,'review');assert.equal(result.status,200);
 let view=await result.json();assert.equal(view.items.length,1);assert.equal(view.next,null);
 assert.equal((await f.call(3,'review')).status,403);
 assert.equal((await f.call(2,'review?after=garbage')).status,400);
 assert.equal((await f.call(2,'review?state=unknown')).status,400);
 await f.call(2,'decision',{submission_id:1,state:'rejected',reason:'نقص'});
 assert.equal((await (await f.call(2,'review')).json()).items.length,0);
 await f.call(3,'appeal',{submission_id:1,reason:'دليل جديد'});
 assert.equal((await (await f.call(2,'review?state=appeals')).json()).items.length,1);
 f.sql.exec('UPDATE scopes SET node_id=12 WHERE user_id=2');
 assert.equal((await (await f.call(2,'review?state=all')).json()).items.length,0);
});
test('invalid or missing season ids are explicit errors',async()=>{
 const f=fixture();
 assert.equal((await f.call(3,'overview?season=wrong')).status,400);
 assert.equal((await f.call(3,'overview?season=999')).status,404);
 assert.equal((await f.call(3,'overview')).status,200);
});
test('group progress reflects approved work and reverses after rejection',async()=>{
 const f=fixture();await setup(f);
 await f.call(2,'join',{season_id:1,display_name:'زميل',public:false});
 let view=await (await f.call(3,'overview')).json();
 assert.equal(view.myGroup.members,2);assert.equal(view.myGroup.participants,0);
 assert.equal(view.groupChallenges[0].completed,0);
 await f.call(2,'decision',{submission_id:1,state:'approved',reason:'مكتمل'});
 view=await (await f.call(3,'overview')).json();
 assert.equal(view.myGroup.score,10);assert.equal(view.myGroup.participants,1);
 assert.equal(view.groupChallenges[0].completed,1);
 await f.call(2,'decision',{submission_id:1,state:'rejected',reason:'تصحيح'});
 view=await (await f.call(3,'overview')).json();
 assert.equal(view.myGroup.score,0);assert.equal(view.groupChallenges[0].completed,0);
});
test('database prevents the original reviewer from resolving a pending appeal',async()=>{
 const f=fixture();await setup(f);
 await f.call(2,'decision',{submission_id:1,state:'rejected',reason:'رفض'});
 await f.call(3,'appeal',{submission_id:1,reason:'اعتراض'});
 assert.throws(()=>f.sql.exec("UPDATE league_submissions SET state='approved',reviewed_by=2 WHERE id=1"),/independent_review_required/);
 assert.equal(f.sql.prepare('SELECT state FROM league_submissions WHERE id=1').get().state,'rejected');
});

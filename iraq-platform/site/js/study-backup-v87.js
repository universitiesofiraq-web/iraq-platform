/* MEDIXA unified per-document local study backup (no cloud access).
   v8.7 format exported Study Suite (v8.5) and workspace (v8.6) keys only.
   Step 40 format adds timer (v8.3), goals (v8.4), cards (study.v1), reader bookmarks, image masks and PDF ink
   for the SAME document. Keys are matched exactly (never by prefix) so one document cannot touch another.
   Import is all-or-nothing: every previous value is read first, each write is verified, and any failure
   restores the exact previous bytes (or removes keys that did not exist). Ink is merged, never replaced.
   See BACKUP-COVERAGE.md for what is and is not included. */
(()=>{'use strict';
const FORMAT='medixa-local-backup-v40', LEGACY='medixa-local-backup-v87';
const MAX_FILE=12_000_000, MAX_VALUE=6_000_000, MAX_ENTRIES=40;
const SUITE_NAMES=['splitNotes','splitPage','imageQuiz','imageQuizReviews'];

// Same validation as the dedicated ink backup (study-ink-backup-v89.js).
const validInk=a=>Array.isArray(a)&&a.length<=100000&&a.every(s=>s&&Number.isInteger(s.page)&&s.page>0&&typeof s.tool==='string'&&Array.isArray(s.points)&&s.points.length<=200000&&s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n))));

/* Exact keys each module uses for this page, derived the same way each module derives them. */
function keysFor(loc){
  const params=new URLSearchParams(loc.search), file=params.get('file');
  const raw=file||loc.pathname;
  let abs=null;if(file){try{abs=new URL(file,loc.href).href}catch{abs=null}}
  const list=[];
  for(const n of SUITE_NAMES)list.push({key:'medixa.v85.'+raw+'.'+n,group:'suite',mode:'replace',legacy:true});
  list.push({key:'medixa.v86.workspace:'+raw,group:'workspace',mode:'replace',legacy:true});
  if(file){
    list.push({key:'medixa.timer.v83:'+file,group:'timer',mode:'replace'});
    list.push({key:'medixa.study.goals.v84:'+file,group:'goals',mode:'replace'});
  }
  if(abs){
    list.push({key:'medixa.study.v1:'+abs,group:'cards',mode:'replace'});
    list.push({key:'medixa.reader.v1:'+abs,group:'reader',mode:'replace'});
    list.push({key:'medixa.occlusion.v1:'+abs,group:'masks',mode:'replace'});
    list.push({key:'medixa.pdf.annotations.v1:'+abs,group:'ink',mode:'merge'});
    list.push({key:'medixa.studio.layout.v1:'+abs,group:'layout',mode:'replace'});
  }
  return {raw,abs,list,byKey:new Map(list.map(x=>[x.key,x]))};
}

function parse(value){try{return {ok:true,value:JSON.parse(value)}}catch{return {ok:false}}}
function validValue(spec,value){const p=parse(value);if(!p.ok)return false;return spec.mode==='merge'?validInk(p.value):p.value!==undefined}

/* Read every key; throws if storage cannot be read (never treat unreadable as empty). */
function readAll(storage,list){const out=new Map();for(const s of list){out.set(s.key,storage.getItem(s.key))}return out}

function buildExport(storage,loc,now){
  const scope=keysFor(loc),entries={},skipped=[];
  const current=readAll(storage,scope.list);
  for(const s of scope.list){const v=current.get(s.key);if(v===null)continue;if(validValue(s,v))entries[s.key]=v;else skipped.push(s.key)}
  return {scope,skipped,data:{format:FORMAT,document:scope.raw,documentUrl:scope.abs,createdAt:new Date(now).toISOString(),entries,skipped}};
}

/* Validate a parsed backup against this page. Returns {plan} or throws Error with a student-facing message. */
function planImport(storage,loc,data){
  const scope=keysFor(loc);
  if(!data||typeof data!=='object'||(data.format!==FORMAT&&data.format!==LEGACY))throw Error('تنسيق النسخة غير معروف');
  if(data.document!==scope.raw||(data.format===FORMAT&&(data.documentUrl??null)!==scope.abs))throw Error('النسخة لا تخص هذه المحاضرة');
  if(!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw Error('محتويات النسخة غير صالحة');
  const entries=Object.entries(data.entries);
  if(!entries.length||entries.length>MAX_ENTRIES)throw Error('محتويات النسخة غير صالحة');
  for(const [k,v] of entries){
    const spec=scope.byKey.get(k);
    if(!spec||typeof v!=='string'||v.length>MAX_VALUE)throw Error('محتويات النسخة غير صالحة');
    if(data.format===LEGACY&&!spec.legacy)throw Error('محتويات النسخة غير صالحة');
    if(data.format===FORMAT&&!validValue(spec,v))throw Error('محتويات النسخة غير صالحة');
  }
  let previous;
  try{previous=readAll(storage,entries.map(([k])=>scope.byKey.get(k)))}catch{throw Error('تعذر قراءة البيانات الحالية؛ لم نغيّر شيئاً')}
  const writes=[];
  for(const [k,v] of entries){
    const spec=scope.byKey.get(k),old=previous.get(k);
    if(spec.mode==='merge'){
      let existing=[];
      if(old!==null){const p=parse(old);if(!p.ok||!validInk(p.value))throw Error('الرسومات الحالية غير صالحة؛ لم نغيّر شيئاً');existing=p.value}
      const seen=new Set(existing.map(x=>JSON.stringify(x))),added=[];
      for(const stroke of JSON.parse(v)){const f=JSON.stringify(stroke);if(!seen.has(f)){seen.add(f);added.push(stroke)}}
      if(!added.length)continue;
      writes.push({key:k,group:spec.group,mode:'merge',previous:old,payload:JSON.stringify(existing.concat(added)),added:added.length});
    }else{
      if(old===v)continue;
      writes.push({key:k,group:spec.group,mode:'replace',previous:old,payload:v});
    }
  }
  return {scope,writes};
}

/* Apply writes atomically from the student's point of view. Returns {ok, rolledBack}. */
function applyPlan(storage,writes){
  const done=[];
  try{
    for(const w of writes){done.push(w);storage.setItem(w.key,w.payload);if(storage.getItem(w.key)!==w.payload)throw Error('verify')}
    return {ok:true};
  }catch{
    let rolledBack=true;
    for(const w of done.reverse()){
      try{if(w.previous===null)storage.removeItem(w.key);else storage.setItem(w.key,w.previous);if(storage.getItem(w.key)!==w.previous)rolledBack=false}catch{rolledBack=false}
    }
    return {ok:false,rolledBack};
  }
}

const GROUP_AR={suite:'الملاحظات وأسئلة الصور',workspace:'مساحة العمل',timer:'المؤقت',goals:'الأهداف',cards:'البطاقات',reader:'العلامات المرجعية',masks:'أقنعة الصور',ink:'رسومات PDF'};

function init(){
  if(!document.getElementById('pages')||document.getElementById('mx87-backup'))return;
  const button=document.createElement('button');button.id='mx87-backup';button.type='button';button.textContent='⇩ نسخة احتياطية شاملة';button.title='تصدير كل بيانات الدراسة لهذا الملف';button.style.cssText='position:fixed;left:12px;bottom:16px;z-index:36;background:#15576b;color:#fff;border:0;border-radius:12px;padding:11px 13px;box-shadow:0 4px 14px #0003;cursor:pointer;font:600 13px system-ui';
  const panel=document.createElement('section');panel.id='mx87-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','نسخ بيانات الدراسة');panel.style.cssText='display:none;position:fixed;left:12px;bottom:66px;z-index:105;width:min(370px,calc(100vw - 24px));max-height:65vh;overflow:auto;background:white;color:#143d4b;padding:16px;border:1px solid #b7d5dc;border-radius:14px;box-shadow:0 8px 30px #0004;direction:rtl;font:14px system-ui';
  panel.innerHTML='<strong>النسخ الاحتياطي المحلي</strong><button id="mx87-close" type="button" style="float:left">✕</button><p>يشمل الملاحظات وأسئلة الصور والبطاقات والأقنعة والرسومات والمؤقت والأهداف والعلامات لهذا الملف فقط، من هذا المتصفح. لا يشمل ملف PDF نفسه ولا بيانات الحساب.</p><button id="mx87-export" type="button">تصدير JSON</button><p>استيراد نسخة محفوظة (سيطلب التأكيد؛ الرسومات تُضاف ولا تُحذف):</p><input id="mx87-import" type="file" accept=".json,application/json"><p id="mx87-status" role="status"></p>';
  const msg=s=>panel.querySelector('#mx87-status').textContent=s;
  button.onclick=()=>panel.style.display=panel.style.display==='none'?'block':'none';
  panel.querySelector('#mx87-close').onclick=()=>panel.style.display='none';
  panel.querySelector('#mx87-export').onclick=()=>{
    let result;try{result=buildExport(localStorage,location,Date.now())}catch{return msg('تعذر قراءة التخزين المحلي؛ لم يُنشأ ملف')}
    const n=Object.keys(result.data.entries).length;
    if(!n)return msg(result.skipped.length?'كل البيانات الموجودة غير صالحة؛ لم يُنشأ ملف':'لا توجد بيانات دراسة لهذا الملف بعد');
    const blob=new Blob([JSON.stringify(result.data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='medixa-study-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    msg('تم تجهيز ملف النسخة الاحتياطية ('+n+' عنصر). احتفظ به في مكان آمن.'+(result.skipped.length?' لم تُضمَّن بيانات تالفة: '+result.skipped.length+'.':''));
  };
  panel.querySelector('#mx87-import').onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>MAX_FILE)throw Error('الملف أكبر من الحد المسموح (12 MB)');
      let data;try{data=JSON.parse(await file.text())}catch{throw Error('الملف ليس JSON صالحاً')}
      const plan=planImport(localStorage,location,data);
      if(!plan.writes.length){msg('النسخة مطابقة للبيانات الحالية؛ لا شيء لاستيراده');return}
      const groups=[...new Set(plan.writes.map(w=>GROUP_AR[w.group]))].join('، ');
      if(!confirm('سيتم استبدال بيانات هذا الملف فقط ('+groups+'). الرسومات تُضاف دون حذف. هل تريد المتابعة؟'))return;
      const r=applyPlan(localStorage,plan.writes);
      if(!r.ok)throw Error(r.rolledBack?'تعذر الاستيراد (مساحة التخزين غالباً)؛ أُعيدت بياناتك كما كانت':'فشل الاستيراد والتراجع! لا تغلق الصفحة وصدّر بياناتك الآن');
      msg('اكتمل الاستيراد. أعد تحميل الصفحة لرؤية البيانات.');
    }catch(err){msg(err.message||'تعذر الاستيراد')}finally{e.target.value=''}
  };
  document.body.append(button,panel);
}
window.MedixaBackup={FORMAT,LEGACY,keysFor,buildExport,planImport,applyPlan};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* MEDIXA v8.5: opt-in reader enhancements; no remote writes. */
(()=>{'use strict';
const ready=()=>{const root=document.getElementById('pages');if(!root||document.getElementById('medixa-suite-toggle'))return;
const file=new URLSearchParams(location.search).get('file')||location.pathname;
const prefix='medixa.v85.'+file+'.';const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(prefix+k))??fallback}catch{return fallback}};
const store=(k,v)=>{try{const payload=JSON.stringify(v);localStorage.setItem(prefix+k,payload);if(localStorage.getItem(prefix+k)!==payload)throw Error('write verification failed');return true}catch{alert('تعذر الحفظ محلياً. تحقق من مساحة التخزين.');return false}};
// Step 34: reject invalid schemas before touching existing student data.
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const pageNumber=n=>Number.isSafeInteger(n)&&n>0;
const validNotes=v=>record(v)&&Object.entries(v).every(([page,text])=>/^[1-9]\d*$/.test(page)&&pageNumber(Number(page))&&typeof text==='string');
const validQuiz=v=>Array.isArray(v)&&v.length<=1000&&v.every(q=>record(q)&&pageNumber(q.page)&&typeof q.question==='string'&&typeof q.answer==='string'&&(!Object.hasOwn(q,'id')||typeof q.id==='string')&&(!Object.hasOwn(q,'maskRef')||typeof q.maskRef==='string'));
const validReviews=v=>record(v)&&Object.values(v).every(r=>record(r)&&['attempts','correct','reviewedAt'].every(k=>!Object.hasOwn(r,k)||(Number.isFinite(r[k])&&r[k]>=0))&&(!Object.hasOwn(r,'lastCorrect')||typeof r.lastCorrect==='boolean'));
// Step 36: display failures safely, but never use fallback data as mutation input.
const loadChecked=(name,fallback,valid)=>{
 const raw=localStorage.getItem(prefix+name);const value=raw===null?fallback:JSON.parse(raw);
 if(!valid(value))throw Error('بيانات الدراسة غير صالحة؛ لم نغيّر بياناتك القديمة');return value;
};
const displayChecked=(name,fallback,valid)=>{try{return loadChecked(name,fallback,valid)}catch{
 const status=document.getElementById('suite-data-status');if(status)status.textContent='تعذرت قراءة بعض بيانات الدراسة؛ البيانات القديمة محفوظة دون تغيير';return fallback;
}};
// Step 27: optional immutable geometry reference; legacy quiz entries remain valid.
const maskKey=()=>{const src=new URLSearchParams(location.search).get('file');return src?'medixa.occlusion.v1:'+new URL(src,location.href).href:null;};
const masksForPage=page=>{try{const k=maskKey();if(!k)return [];const v=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(v)?v.map((m,index)=>({m,index})).filter(({m})=>m&&m.page===page&&[m.x,m.y,m.w,m.h].every(n=>typeof n==='number'&&Number.isFinite(n))):[];}catch{return [];}};
const maskFingerprint=m=>[m.page,m.x,m.y,m.w,m.h].map(n=>Number(n).toFixed(5)).join(':');
const normalizeAnswer=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active='dashboard', quizIndex=0;const header=document.querySelector('header');const btn=document.createElement('button');btn.id='medixa-suite-toggle';btn.textContent='▦ مساحة الدراسة +';header.appendChild(btn);
const drawer=document.createElement('aside');drawer.id='medixa-suite';drawer.setAttribute('aria-label','مساحة الدراسة المتقدمة');drawer.innerHTML=`<div class="suite-head"><b>MEDIXA • Study Suite</b><button id="suite-close" aria-label="إغلاق">×</button></div><nav id="suite-nav"><button data-view="dashboard">لوحة الدراسة</button><button data-view="split">عرض مزدوج</button><button data-view="image">اختبار الصور</button><button data-view="search">بحث PDF</button><button data-view="offline">حفظ ونسخ احتياطي</button></nav><p id="suite-data-status" role="status" aria-live="polite"></p><div id="suite-content"></div>`;document.body.appendChild(drawer);
btn.onclick=()=>{stopSearch();drawer.classList.add('open');render()};drawer.querySelector('#suite-close').onclick=()=>{stopSearch();drawer.classList.remove('open')};drawer.querySelector('#suite-nav').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;stopSearch();active=b.dataset.view;render()};
const content=drawer.querySelector('#suite-content');const pages=()=>root.querySelectorAll('.page').length;const pageGo=n=>{const p=root.querySelectorAll('.page')[n-1];if(p){drawer.classList.remove('open');p.scrollIntoView({behavior:'smooth',block:'start'})}};
// Step 37: one active search; failed/cancelled jobs cannot publish stale results.
let searchJob=null;
async function releaseSearch(job){
 if(!job.pdf||job.released)return;job.released=true;
 try{await job.pdf.destroy()}catch{ /* Cleanup failure must not turn a cancelled job into an unhandled rejection. */ }
}
function stopSearch(showStatus=false){
 const job=searchJob;if(!job)return;searchJob=null;job.cancelled=true;
 if(showStatus&&document.getElementById('suite-results')===job.out)job.out.textContent='تم إلغاء البحث';
 void releaseSearch(job);
}
async function searchPDF(term,out){
 stopSearch();const job={out,pdf:null,released:false,cancelled:false};searchJob=job;
 const current=()=>searchJob===job&&!job.cancelled&&active==='search'&&document.getElementById('suite-results')===out;
 out.textContent='جارٍ البحث...';
 try{
  const src=new URLSearchParams(location.search).get('file');
  job.pdf=await pdfjsLib.getDocument({url:src}).promise;
  if(!current())return;
  const results=[];
  for(let i=1;i<=job.pdf.numPages;i++){
   if(!current())return;
   const page=await job.pdf.getPage(i);if(!current())return;
   const text=await page.getTextContent();if(!current())return;
   const full=text.items.map(x=>x.str).join(' '),at=full.toLocaleLowerCase().indexOf(term);
   if(at!==-1)results.push({page:i,excerpt:full.slice(Math.max(0,at-55),Math.min(full.length,at+term.length+80))});
   if(i%5===0)out.textContent=`تم فحص ${i} من ${job.pdf.numPages} صفحة...`;
  }
  if(current())out.innerHTML=results.length?results.map(r=>`<div class="suite-result"><button data-resultpage="${r.page}">صفحة ${r.page}</button><p dir="auto">${safe(r.excerpt)}</p></div>`).join(''):'لا توجد نتائج نصية. قد يكون الملف صورة ممسوحة ضوئياً.';
 }catch(err){if(current())out.textContent='تعذر البحث: '+err.message;}
 finally{await releaseSearch(job);if(searchJob===job)searchJob=null;}
}
// Step 35: keep failed writes in memory until explicitly retried; never claim durability.
const noteDrafts=new Map();let notePage=null;
const noteWarning='تعذر حفظ الملاحظة؛ انسخ النص قبل مغادرة الصفحة';
function showNote(page){
 const input=document.getElementById('suite-note'),status=document.getElementById('suite-save-status');
 if(!input||!status)return;
 if(noteDrafts.has(page)){input.value=noteDrafts.get(page);status.textContent=noteWarning;return;}
 try{const raw=localStorage.getItem(prefix+'splitNotes');const notes=raw===null?{}:JSON.parse(raw);
  if(!validNotes(notes))throw Error('invalid notes');input.value=notes[page]||'';status.textContent='';
 }catch{input.value='';status.textContent='تعذرت قراءة الملاحظات؛ لن نستبدل البيانات القديمة';}
}
function saveNote(page,text){
 const status=document.getElementById('suite-save-status');noteDrafts.set(page,text);
 const key=prefix+'splitNotes';
 try{const raw=localStorage.getItem(key);const notes=raw===null?{}:JSON.parse(raw);
  if(!validNotes(notes))throw Error('invalid notes');notes[page]=text;
  const payload=JSON.stringify(notes);localStorage.setItem(key,payload);
  if(localStorage.getItem(key)!==payload)throw Error('write verification failed');
  noteDrafts.delete(page);status.textContent='محفوظ ✓';return true;
 }catch{status.textContent=noteWarning;return false;}
}
window.addEventListener('beforeunload',e=>{if(noteDrafts.size){e.preventDefault();e.returnValue='';}});
function render(){document.getElementById('suite-data-status').textContent='';drawer.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===active));
if(active==='dashboard'){const imgs=displayChecked('imageQuiz',[],validQuiz),notes=displayChecked('splitNotes',{},validNotes);content.innerHTML=`<h3>ملخص المحاضرة</h3><div class="suite-stats"><div><b>${pages()}</b><small>صفحة معروضة</small></div><div><b>${imgs.length}</b><small>اختبارات صور</small></div><div><b>${Object.values(notes).filter(Boolean).length}</b><small>ملاحظات صفحات</small></div></div><p>هذه الإحصائيات محلية لهذا الملف والمتصفح، وليست مزامنة مع حساب الطالب.</p><button id="suite-export">تصدير بيانات الإضافات</button><p class="suite-muted">المؤقت والبطاقات وباقي الأدوات متاحة من شريط القارئ الأصلي.</p>`;}
if(active==='split'){
 const stored=Number(read('splitPage',1));if(notePage===null)notePage=pageNumber(stored)?stored:1;
 notePage=Math.min(notePage,Math.max(pages(),1));const n=notePage;
 content.innerHTML=`<h3>ملاحظات بجانب المحاضرة</h3><p>اختر الصفحة، ثم اكتب ملاحظتك. تُحفظ تلقائياً على هذا الجهاز.</p><label>الصفحة <input id="suite-page" type="number" min="1" max="${Math.max(pages(),1)}" value="${n}"></label><button id="suite-goto">انتقل للصفحة</button><textarea id="suite-note" rows="12" placeholder="ملاحظاتك لهذه الصفحة..."></textarea><span id="suite-save-status" role="status" aria-live="polite"></span><button id="suite-retry-note" type="button">إعادة محاولة حفظ الملاحظة</button><button id="suite-split">${document.body.classList.contains('medixa-split')?'إغلاق':'تفعيل'} العرض المزدوج</button>`;
 showNote(n);
}
if(active==='image'){const list=displayChecked('imageQuiz',[],validQuiz);content.innerHTML=`<h3>اختبار تسمية صورة طبية</h3><p>اختر صفحة PDF واكتب السؤال والإجابة. يحفظ النظام رابط الصفحة مع السؤال لتراجعها لاحقاً.</p><label>الصفحة <input type="number" id="iq-page" min="1" max="${Math.max(1,pages())}" value="1"></label><input id="iq-q" placeholder="مثال: ما اسم البنية المشار إليها؟"><input id="iq-a" placeholder="الإجابة الصحيحة"><label>ربط بقناع Study Mask (اختياري) <select id="iq-mask"><option value="">بدون قناع</option></select></label><button id="iq-add">إضافة اختبار صورة</button><h4>بطاقات الصور (${list.length})</h4><div id="iq-list">${list.map((q,i)=>`<article class="suite-quiz"><b>${safe(q.question)}</b><small>صفحة ${q.page}${q.maskRef?" • "+(masksForPage(q.page).some(({m})=>maskFingerprint(m)===q.maskRef)?"قناع مرتبط":"القناع الأصلي غير موجود"):""}</small><div><button data-iqgo="${q.page}">عرض الصفحة</button><button data-iqshow="${i}">كشف الإجابة</button><button data-iqdelete="${i}">حذف</button></div><label>إجابتك <input data-iqinput="${i}" autocomplete="off" aria-label="إجابة السؤال ${i+1}"></label><button data-iqcheck="${i}">تحقق</button><span role="status" id="iq-feedback-${i}"></span><p id="iq-answer-${i}" hidden>${safe(q.answer)}</p></article>`).join('')}</div><p class="suite-muted">هذا اختبار صور مرتبط بصفحات PDF؛ استخدم Study Mask لإخفاء مناطق الصفحة؛ ثم اعرض الصفحة وحاول الإجابة هنا. التقييم نصي ويتجاهل اختلاف حالة الأحرف والمسافات، ولا يفهم المرادفات.</p>`;updateMaskChoices();}
if(active==='search'){content.innerHTML=`<h3>البحث داخل النص</h3><p>يعمل على النصوص القابلة للاستخراج من PDF، ولا يشمل الصور الممسوحة ضوئياً (OCR).</p><input id="suite-query" placeholder="ابحث في المحاضرة..." dir="auto"><button id="suite-search">بحث</button><button id="suite-cancel-search" type="button">إلغاء البحث</button><div id="suite-results" role="status"></div>`;}
if(active==='offline'){content.innerHTML=`<h3>نسخة احتياطية محلية</h3><p>احفظ اختبارات الصور وملاحظات العرض المزدوج، أو استعدها على نفس الملف.</p><button id="suite-export">تنزيل JSON</button><label>استيراد JSON <input id="suite-import" type="file" accept="application/json,.json"></label><p class="suite-muted">لا تشمل هذه النسخة ملفات PDF الأصلية أو رسومات القلم أو بيانات أدوات الدراسة القديمة. لا يوجد مزامنة Firebase أو ضمان للعمل دون إنترنت.</p>`;}}
function updateMaskChoices(){const select=document.getElementById('iq-mask');if(!select)return;const page=Number(document.getElementById('iq-page')?.value);const current=select.value;select.replaceChildren(new Option('بدون قناع',''));masksForPage(page).forEach(({m,index})=>select.add(new Option('قناع '+(index+1),maskFingerprint(m))));if(Array.from(select.options).some(o=>o.value===current))select.value=current;}
content.addEventListener('change',e=>{if(e.target.id==='iq-page')updateMaskChoices();});
content.addEventListener('input',e=>{
 if(e.target.id==='suite-note'){
  const n=Number(document.getElementById('suite-page')?.value);
  if(!pageNumber(n)||n>pages())return;
  notePage=n;saveNote(n,e.target.value);
 }
 if(e.target.id==='suite-page'){
  const n=Number(e.target.value);if(!pageNumber(n)||n>pages())return;
  notePage=n;store('splitPage',n);showNote(n);
 }
});
content.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
if(b.id==='suite-retry-note'){const n=Number(document.getElementById('suite-page')?.value);if(pageNumber(n)&&n<=pages())saveNote(n,document.getElementById('suite-note').value);return;}
if(b.id==='suite-goto')return pageGo(Number(document.getElementById('suite-page').value));
if(b.id==='suite-split'){document.body.classList.toggle('medixa-split');render();return}
if(b.id==='iq-add'){const page=Number(document.getElementById('iq-page').value),question=document.getElementById('iq-q').value.trim(),answer=document.getElementById('iq-a').value.trim();if(!Number.isInteger(page)||page<1||page>pages()||!question||!answer)return alert('أكمل رقم الصفحة والسؤال والإجابة');const arr=loadChecked('imageQuiz',[],validQuiz);const ref=document.getElementById('iq-mask')?.value||'';if(ref&&!masksForPage(page).some(({m})=>maskFingerprint(m)===ref))return alert('القناع المحدد غير متاح');if(arr.length>=1000)return alert('وصلت إلى الحد الأقصى لأسئلة الصور؛ صدّر نسخة احتياطية قبل تنظيمها');arr.push({id:crypto.randomUUID?.()||String(Date.now()),page,question,answer,...(ref?{maskRef:ref}:{})});if(store('imageQuiz',arr))render();return}
if(b.dataset.iqgo)return pageGo(Number(b.dataset.iqgo));
if(b.hasAttribute('data-iqcheck')){const i=Number(b.dataset.iqcheck),item=loadChecked('imageQuiz',[],validQuiz)[i],input=content.querySelector('[data-iqinput=\"'+i+'\"]'),feedback=document.getElementById('iq-feedback-'+i);if(!Number.isInteger(i)||i<0||!item||!input||!feedback)return;const entered=normalizeAnswer(input.value);if(!entered){feedback.textContent='اكتب إجابتك أولاً';return;}const correct=entered===normalizeAnswer(item.answer);const history=loadChecked('imageQuizReviews',{},validReviews);const id=String(item.id||i);const previous=Object.hasOwn(history,id)?history[id]:{};Object.defineProperty(history,id,{value:{...previous,attempts:Math.min(100000,(Number(previous.attempts)||0)+1),correct:Math.min(100000,(Number(previous.correct)||0)+(correct?1:0)),lastCorrect:correct,reviewedAt:Date.now()},enumerable:true,writable:true,configurable:true});if(store('imageQuizReviews',history))feedback.textContent=correct?'صحيح ✓':'غير صحيح؛ راجع الإجابة أو الصفحة';else feedback.textContent='تعذر حفظ النتيجة؛ لم يتم تسجيل المحاولة';return;}
if(b.dataset.iqshow){const p=document.getElementById('iq-answer-'+b.dataset.iqshow);if(p)p.hidden=!p.hidden;return}
if(b.dataset.iqdelete){if(!confirm('حذف هذا السؤال؟'))return;const arr=loadChecked('imageQuiz',[],validQuiz);const index=Number(b.dataset.iqdelete);if(!Number.isInteger(index)||index<0||index>=arr.length)return;arr.splice(index,1);if(store('imageQuiz',arr))render();return}
if(b.id==='suite-export'){const data={format:'medixa-suite-v85',file,notes:loadChecked('splitNotes',{},validNotes),imageQuiz:loadChecked('imageQuiz',[],validQuiz),imageQuizReviews:loadChecked('imageQuizReviews',{},validReviews)};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='medixa-study-suite-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return}
if(b.id==='suite-cancel-search'){stopSearch(true);return;}
if(b.id==='suite-search'){
 const term=document.getElementById('suite-query').value.trim().toLocaleLowerCase(),out=document.getElementById('suite-results');
 if(term.length<2){stopSearch();out.textContent='اكتب حرفين على الأقل';return;}
 if(!window.pdfjsLib){stopSearch();out.textContent='مكتبة PDF غير متاحة';return;}
 await searchPDF(term,out);return;
}
if(b.dataset.resultpage)return pageGo(Number(b.dataset.resultpage));
}catch(err){alert('تعذر تنفيذ العملية؛ لم نعتبر البيانات غير المقروءة فارغة: '+err.message)}});
content.addEventListener('change',async e=>{
 if(e.target.id!=='suite-import')return;
 const f=e.target.files?.[0];if(!f)return;
 try{
  if(f.size>2e6)throw Error('ملف غير صالح أو كبير');
  const v=JSON.parse(await f.text());
  if(!record(v)||v.format!=='medixa-suite-v85'||v.file!==file||!validNotes(v.notes)||!validQuiz(v.imageQuiz)||
    (Object.hasOwn(v,'imageQuizReviews')&&!validReviews(v.imageQuizReviews)))throw Error('صيغة أو ملف مختلف أو بيانات غير صالحة');
  if(noteDrafts.size)throw Error('توجد ملاحظات غير محفوظة؛ انسخها أو أعد محاولة حفظها قبل الاستيراد');
  if(!confirm('استبدال ملاحظات واختبارات هذه المحاضرة بالنسخة المستوردة؟'))return;
  const entries=[['splitNotes',v.notes],['imageQuiz',v.imageQuiz]];
  if(Object.hasOwn(v,'imageQuizReviews'))entries.push(['imageQuizReviews',v.imageQuizReviews]);
  // Read every original value before the first mutation. Never silently truncate a backup.
  const prepared=entries.map(([name,value])=>({key:prefix+name,previous:localStorage.getItem(prefix+name),payload:JSON.stringify(value)}));
  const snapshots=[];
  try{
   for(const {key,previous,payload} of prepared){
    snapshots.push([key,previous]);localStorage.setItem(key,payload);
    if(localStorage.getItem(key)!==payload)throw Error('فشل التحقق من الحفظ');
   }
  }catch(writeError){
   let rollbackOK=true;
   for(const [key,previous] of snapshots.reverse()){
    try{if(localStorage.getItem(key)!==previous){if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);}
     if(localStorage.getItem(key)!==previous)rollbackOK=false;
    }catch{rollbackOK=false;}
   }
   throw Error(rollbackOK?'فشل الاستيراد؛ تمت استعادة البيانات السابقة.':'فشل الاستيراد وتعذرت استعادة بعض البيانات؛ لا تغلق الصفحة قبل تصدير نسخة احتياطية.');
  }
  render();
 }catch(err){alert('تعذر الاستيراد: '+err.message)}finally{e.target.value='';}
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){stopSearch();drawer.classList.remove('open')}});};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();})();

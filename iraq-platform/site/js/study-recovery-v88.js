/* MEDIXA Step 02: non-destructive per-document session recovery. */
(()=>{'use strict';
function init(){const pages=document.getElementById('pages');if(!pages)return;
const doc=new URLSearchParams(location.search).get('file');if(!doc)return;
const key='medixa.v88.session:'+new URL(doc,location.href).href;
let previous=null,dirty=false,storageOK=true;
try{const raw=localStorage.getItem(key);if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.version===1&&parsed.document===doc&&Number.isInteger(parsed.page)&&parsed.page>0)previous=parsed;}}catch(e){storageOK=false;}
const bar=document.createElement('div');bar.id='mx88-recovery';bar.setAttribute('role','status');bar.setAttribute('aria-live','polite');bar.setAttribute('aria-atomic','true');bar.style.cssText='position:fixed;top:10px;left:10px;z-index:200;background:#fff;color:#123e51;padding:10px;border:1px solid #9bbac6;border-radius:12px;box-shadow:0 4px 20px #0003;font:14px system-ui;max-width:min(340px,90vw);direction:rtl';
const message=document.createElement('span');const resume=document.createElement('button');resume.textContent='استعادة الصفحة';resume.type='button';resume.setAttribute('aria-label','استعادة آخر صفحة محفوظة');resume.style.margin='0 8px';const close=document.createElement('button');close.textContent='إغلاق';close.type='button';close.setAttribute('aria-label','بدء جلسة جديدة وإغلاق رسالة الاستعادة');bar.append(message,resume,close);document.body.append(bar);
const warning=t=>{message.textContent=t;bar.style.display='block';resume.hidden=true;};
if(!storageOK)warning('تعذر قراءة الحفظ المحلي. لا تغلق الصفحة قبل تصدير نسخة من أدوات الدراسة.');else if(previous){message.textContent='جلسة سابقة: صفحة '+previous.page;resume.hidden=false;}else bar.style.display='none';
close.onclick=()=>{if(!storageOK){warning('التخزين المحلي غير متاح؛ لن يتم استبدال البيانات القديمة.');return;}pendingResume=false;previous=null;bar.style.display='none';save();};
const pageNow=()=>{let best=1,d=Infinity;pages.querySelectorAll('.page').forEach((p,i)=>{const v=Math.abs(p.getBoundingClientRect().top-95);if(v<d){d=v;best=i+1;}});return best;};
let pendingResume=false,restoredPage=null;
function restoreWhenReady(){if(!pendingResume||!previous)return;const el=pages.querySelectorAll('.page')[previous.page-1];if(el){el.scrollIntoView({block:'start'});restoredPage=previous.page;pendingResume=false;previous=null;bar.style.display='none';save();}}
resume.onclick=()=>{pendingResume=true;resume.hidden=true;message.textContent='بانتظار تحميل الصفحة السابقة...';restoreWhenReady();};
function save(){if(!storageOK||previous||pendingResume||!pages.querySelector('.page'))return false;const state={version:1,document:doc,page:restoredPage||pageNow(),savedAt:Date.now()};try{const payload=JSON.stringify(state);localStorage.setItem(key,payload);if(localStorage.getItem(key)!==payload)throw Error('Storage verification failed');dirty=false;storageOK=true;return true;}catch(e){storageOK=false;warning('فشل حفظ الجلسة (قد تكون مساحة التخزين ممتلئة). صدّر بيانات الدراسة قبل إغلاق الصفحة.');return false;}}
let timer;window.addEventListener('scroll',()=>{restoredPage=null;dirty=true;clearTimeout(timer);timer=setTimeout(save,850)},{passive:true});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save();});window.addEventListener('pagehide',save);
const observer=new MutationObserver(()=>{restoreWhenReady();if(!previous&&pages.querySelector('.page')){observer.disconnect();save();}});observer.observe(pages,{childList:true});if(pages.querySelector('.page')&&!previous){observer.disconnect();save();}
window.medixaSessionRecovery={save,getStatus:()=>({storageOK,dirty,previousPage:previous?.page||null})};
}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

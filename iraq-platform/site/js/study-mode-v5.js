/* MEDIXA Study Mode v5: additive reader controls, per-document bookmarks, navigation, split view. */
(()=>{'use strict';
const root=document.getElementById('pages');if(!root)return;
const params=new URLSearchParams(location.search),file=params.get('file');if(!file)return;
const key='medixa.reader.v1:'+new URL(file,location.href).href;
let state={bookmarks:[],lastPage:1,dark:false};try{const v=JSON.parse(localStorage.getItem(key)||'{}');if(v&&typeof v==='object')state={...state,...v}}catch{}
if(!Array.isArray(state.bookmarks))state.bookmarks=[];
const persist=()=>{try{localStorage.setItem(key,JSON.stringify(state))}catch{}};
const bar=document.createElement('nav');bar.id='medixa-reader-bar';bar.setAttribute('aria-label','أدوات قراءة PDF');
bar.innerHTML='<button id="medixa-thumbs-toggle" type="button">▦ الصفحات</button><button id="medixa-bookmark" type="button">☆ حفظ الصفحة</button><button id="medixa-dark" type="button">◐ الوضع الليلي</button><button id="medixa-focus" type="button">⛶ ملء الشاشة</button><button id="medixa-split-toggle" type="button">◫ تقسيم الشاشة</button><button id="medixa-prev" type="button">→ السابقة</button><span class="medixa-current" id="medixa-page-label">صفحة 1</span><button id="medixa-next" type="button">← التالية</button>';
root.before(bar);
const thumbs=document.createElement('aside');thumbs.id='medixa-thumbs';thumbs.setAttribute('aria-label','الصور المصغرة والإشارات المرجعية');thumbs.innerHTML='<strong>الصفحات</strong><div id="medixa-thumbs-list"></div><hr><strong>الإشارات المرجعية</strong><div id="medixa-bookmarks"></div>';document.body.append(thumbs);
const split=document.createElement('aside');split.id='medixa-split';split.innerHTML='<button id="medixa-split-close" type="button">✕ إغلاق العرض الثاني</button><iframe title="ملف PDF الثاني" loading="lazy"></iframe>';document.body.append(split);
const exit=document.createElement('button');exit.id='medixa-focus-exit';exit.textContent='إنهاء وضع التركيز';document.body.append(exit);
let current=1,ready=false;
const pages=()=>[...root.querySelectorAll('.page')];
function goto(n){const arr=pages();if(!arr.length)return;current=Math.max(1,Math.min(arr.length,n));arr[current-1].scrollIntoView({behavior:'smooth',block:'start'});state.lastPage=current;persist();refresh()}
function refresh(){document.getElementById('medixa-page-label').textContent='صفحة '+current+' / '+pages().length;document.getElementById('medixa-bookmark').textContent=state.bookmarks.includes(current)?'★ إزالة العلامة':'☆ حفظ الصفحة';const box=document.getElementById('medixa-bookmarks');box.replaceChildren();state.bookmarks.sort((a,b)=>a-b).forEach(n=>{const b=document.createElement('button');b.type='button';b.textContent='★ صفحة '+n;b.onclick=()=>goto(n);box.append(b)})}
function initialize(){if(ready||!pages().length)return;ready=true;const list=document.getElementById('medixa-thumbs-list');pages().forEach((p,i)=>{const b=document.createElement('button');b.type='button';const canvas=p.querySelector('canvas.pdf');const img=document.createElement('img');img.alt='معاينة الصفحة '+(i+1);try{img.src=canvas.toDataURL('image/jpeg',.28)}catch{}b.append(img,document.createTextNode('صفحة '+(i+1)));b.onclick=()=>{goto(i+1);thumbs.classList.remove('open')};list.append(b)});if(state.dark)document.body.classList.add('medixa-dark');refresh();if(state.lastPage>1)goto(state.lastPage)}
new MutationObserver(()=>{if(!ready&&pages().length){setTimeout(initialize,1000)}}).observe(root,{childList:true});
document.getElementById('medixa-thumbs-toggle').onclick=()=>thumbs.classList.toggle('open');
document.getElementById('medixa-bookmark').onclick=()=>{state.bookmarks=state.bookmarks.includes(current)?state.bookmarks.filter(x=>x!==current):[...state.bookmarks,current];persist();refresh()};
document.getElementById('medixa-dark').onclick=()=>{state.dark=!state.dark;document.body.classList.toggle('medixa-dark',state.dark);persist()};
const focus=()=>document.body.classList.toggle('medixa-focus');document.getElementById('medixa-focus').onclick=focus;exit.onclick=focus;
document.getElementById('medixa-prev').onclick=()=>goto(current-1);document.getElementById('medixa-next').onclick=()=>goto(current+1);
const closeSplit=()=>{split.classList.remove('open');document.body.classList.remove('medixa-split-on');split.querySelector('iframe').src='about:blank'};
document.getElementById('medixa-split-close').onclick=closeSplit;
document.getElementById('medixa-split-toggle').onclick=()=>{if(split.classList.contains('open'))return closeSplit();const second=prompt('رابط PDF الثاني من نفس الموقع (اتركه فارغاً لفتح الملف الحالي):','')?.trim();if(second===null||second===undefined)return;let u;try{u=new URL(second||file,location.href);if(u.origin!==location.origin)throw Error('يجب أن يكون الملف من نفس الموقع');if(!/\.pdf(?:$|[?#])/i.test(u.href))throw Error('اختر رابط PDF');}catch(e){alert(e.message);return}split.querySelector('iframe').src='./pdf-notes.html?file='+encodeURIComponent(u.pathname+u.search);split.classList.add('open');document.body.classList.add('medixa-split-on')};
let ticking=false;document.addEventListener('scroll',()=>{if(!ready||ticking)return;ticking=true;requestAnimationFrame(()=>{ticking=false;const arr=pages();let closest=1,best=Infinity;arr.forEach((p,i)=>{const d=Math.abs(p.getBoundingClientRect().top-130);if(d<best){best=d;closest=i+1}});if(closest!==current){current=closest;state.lastPage=current;persist();refresh()}})},{passive:true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){thumbs.classList.remove('open');document.body.classList.remove('medixa-focus')}if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(e.key==='PageDown')goto(current+1);if(e.key==='PageUp')goto(current-1)});
})();
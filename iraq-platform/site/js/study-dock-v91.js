/* MEDIXA Step 41: one bottom dock for the PDF reader's floating study tools.
   Layout only. It moves the existing elements (their handlers, state and storage are untouched)
   so they no longer cover each other on phone, iPad or desktop. Load it after every study module. */
(()=>{'use strict';
const ORDER=['mx-reader-nav','mx-occlusion','mx-timer-float','mx86-open','mx87-backup','mx-ink-toggle','mx-save-state'];
const POPUPS=['mx87-panel','mx86-panel','mx-ink-panel'];
let dock=null;

function css(){
  const s=document.createElement('style');s.id='mx-dock-style';s.textContent=`
#mx-dock{position:fixed;left:0;right:0;bottom:0;z-index:220;display:flex;align-items:center;gap:8px;padding:8px max(12px,env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:#122c47;border-top:1px solid #ffffff30;box-shadow:0 -6px 20px #0002;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;direction:rtl}
#mx-dock>*{position:static!important;inset:auto!important;transform:none!important;margin:0!important;flex:0 0 auto;box-shadow:none!important;max-width:none!important}
#mx-dock>#mx-reader-nav{background:transparent;border:0;padding:0}
#mx-dock>#mx-occlusion{display:flex!important;flex-wrap:nowrap!important;align-items:center;gap:4px;padding:4px 6px!important;font-size:13px!important}
#mx-dock>#mx-occlusion button{padding:6px 8px}
#mx-dock>button,#mx-dock>details>summary{min-height:44px}
#mx-dock #mx-reader-nav button,#mx-dock #mx-reader-nav input,#mx-dock #mx-occlusion button{min-height:44px;min-width:44px}
#mx-dock>#mx-ink-toggle{background:#e3f3f1;color:#153d4a;border:0;border-radius:12px;padding:10px 12px;font:700 13px system-ui;cursor:pointer}
#mx-dock>#mx-ink-toggle[aria-expanded="true"]{outline:2px solid #69d6c9}
#mx-dock>#mx-save-state{background:#fff;border-radius:10px;padding:9px 10px!important;font:600 13px system-ui!important}
#mx-dock.mx-more{-webkit-mask-image:linear-gradient(to left,transparent 0,#000 40px);mask-image:linear-gradient(to left,transparent 0,#000 40px)}
#mx-dock.mx-more.mx-end{-webkit-mask-image:none;mask-image:none}
#mx-dock>#mx-save-state[open]>p{position:fixed;right:12px;bottom:calc(var(--mx-dock-h,64px) + 8px);margin:0;background:#fff;color:#123;border:1px solid #abc;border-radius:9px;padding:8px;max-width:min(300px,calc(100vw - 24px))}
#mx-ink-panel{bottom:calc(var(--mx-dock-h,64px) + 8px)!important;left:12px!important;max-width:calc(100vw - 24px)}
#mx-ink-panel[hidden]{display:none!important}
${POPUPS.filter(id=>id!=='mx-ink-panel').map(id=>'#'+id).join(',')}{bottom:calc(var(--mx-dock-h,64px) + 8px)!important;max-height:calc(100vh - var(--mx-dock-h,64px) - 24px)!important}
body.mx-docked{padding-bottom:calc(var(--mx-dock-h,64px) + 12px)!important}
#mx-dock button:focus-visible,#mx-dock summary:focus-visible{outline:3px solid #69d6c9;outline-offset:2px}
`;document.head.append(s);
}

/* The v8.9 ink backup is an always-open <aside>; give it an id and a toggle so it stops covering other tools. */
function adoptInk(){
  if(document.getElementById('mx-ink-toggle'))return;
  const exp=document.getElementById('mx89-export');const panel=exp&&exp.closest('aside');if(!panel)return;
  panel.id='mx-ink-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','نسخة رسومات PDF');
  const t=document.createElement('button');t.type='button';t.id='mx-ink-toggle';t.textContent='✎ نسخة الرسومات';t.setAttribute('aria-controls','mx-ink-panel');t.setAttribute('aria-expanded','false');
  t.addEventListener('click',()=>{panel.hidden=!panel.hidden;t.setAttribute('aria-expanded',String(!panel.hidden))});
  document.body.append(t);
}

/* The read-only save-state <details> has no id. */
function adoptDiagnostics(){
  if(document.getElementById('mx-save-state'))return;
  for(const d of document.querySelectorAll('body>details')){const s=d.querySelector('summary');if(s&&s.textContent.trim()==='حالة الحفظ المحلي'){d.id='mx-save-state';return}}
}

function place(){
  if(!dock)return;
  adoptInk();adoptDiagnostics();
  for(const id of ORDER){const el=document.getElementById(id);if(el&&el.parentNode!==dock)dock.append(el)}
  // keep the configured order
  for(const id of ORDER){const el=document.getElementById(id);if(el)dock.append(el)}
  measure();
}
function measure(){if(!dock)return;document.documentElement.style.setProperty('--mx-dock-h',dock.offsetHeight+'px');edge()}
// Fade the far edge while more tools are hidden off-screen (RTL: they overflow to the left).
function edge(){if(!dock)return;const more=dock.scrollWidth>dock.clientWidth+2;dock.classList.toggle('mx-more',more);dock.classList.toggle('mx-end',more&&Math.abs(dock.scrollLeft)+dock.clientWidth>=dock.scrollWidth-2)}

function init(){
  if(!document.getElementById('pages')||document.getElementById('mx-dock'))return;
  css();
  dock=document.createElement('div');dock.id='mx-dock';dock.setAttribute('role','toolbar');dock.setAttribute('aria-label','أدوات القراءة والدراسة');
  document.body.append(dock);document.body.classList.add('mx-docked');
  place();
  // Some tools may be added after this script runs; adopt them when they appear.
  let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(ORDER.some(id=>{const el=document.getElementById(id);return el&&el.parentNode!==dock})||document.getElementById('mx89-export')&&!document.getElementById('mx-ink-toggle'))place()})}).observe(document.body,{childList:true});
  dock.addEventListener('scroll',edge,{passive:true});
  if(window.ResizeObserver)new ResizeObserver(measure).observe(dock);else window.addEventListener('resize',measure);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

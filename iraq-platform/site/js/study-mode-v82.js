/* MEDIXA v8.2: lightweight study navigation; no PDF rendering changes. */
(()=>{'use strict';
const root=document.getElementById('pages');if(!root)return;
const css=document.createElement('style');css.textContent=`
#mx-reader-nav{position:fixed;bottom:14px;right:50%;transform:translateX(50%);z-index:8;display:flex;align-items:center;gap:7px;padding:8px 12px;background:#122c47f2;color:white;border:1px solid #ffffff30;border-radius:16px;box-shadow:0 8px 24px #0003;direction:rtl;max-width:calc(100vw - 16px);font-size:13px}
#mx-reader-nav button{padding:7px 11px;border:0;border-radius:9px;background:#e3f3f1;color:#153d4a;font-weight:700}
#mx-reader-nav input{width:52px;min-width:0;border-radius:8px;border:1px solid #9db6bf;padding:7px;text-align:center;font:inherit}
#mx-reader-nav [data-mx-total]{white-space:nowrap}
#mx-reader-nav button:focus-visible,#mx-reader-nav input:focus-visible{outline:3px solid #69d6c9}
#mx-reader-nav[hidden]{display:none!important}
@media(max-width:480px){#mx-reader-nav{bottom:8px;padding:6px;gap:4px}#mx-reader-nav button{padding:7px}body{padding-bottom:60px}}
`;document.head.append(css);
const nav=document.createElement('nav');nav.id='mx-reader-nav';nav.setAttribute('aria-label','التنقل بين صفحات المحاضرة');nav.hidden=true;
nav.innerHTML='<button type="button" data-mx-prev aria-label="الصفحة السابقة">→</button><label>صفحة <input data-mx-page inputmode="numeric" type="number" min="1" aria-label="رقم الصفحة"></label><span data-mx-total> / 0</span><button type="button" data-mx-next aria-label="الصفحة التالية">←</button><button type="button" data-mx-study aria-label="فتح أدوات الدراسة">دراسة</button>';
document.body.append(nav);
const input=nav.querySelector('[data-mx-page]'),total=nav.querySelector('[data-mx-total]');let pages=[],active=1,observer=null;
function goto(n){n=Math.min(pages.length,Math.max(1,Math.floor(Number(n)||1)));if(!pages[n-1])return;active=n;input.value=n;pages[n-1].scrollIntoView({behavior:'auto',block:'start'});}
function refresh(){pages=[...root.querySelectorAll('.page')];nav.hidden=!pages.length;total.textContent=' / '+pages.length;input.max=pages.length;if(pages.length&&!input.value)input.value='1';if(observer)observer.disconnect();if(!pages.length)return;
observer=new IntersectionObserver(entries=>{let best=null;for(const e of entries){if(e.isIntersecting&&(!best||e.intersectionRatio>best.intersectionRatio))best=e;}if(best){const index=pages.indexOf(best.target);if(index>=0){active=index+1;input.value=active;}}},{rootMargin:'-12% 0px -40% 0px',threshold:[0,.25,.5,.75]});pages.forEach(p=>observer.observe(p));}
let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh()})}).observe(root,{childList:true});refresh();
nav.querySelector('[data-mx-prev]').onclick=()=>goto(active-1);nav.querySelector('[data-mx-next]').onclick=()=>goto(active+1);input.onchange=()=>goto(input.value);
nav.querySelector('[data-mx-study]').onclick=()=>document.getElementById('study-launch')?.click();
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.getElementById('study-panel')?.classList.remove('open');return}if(e.altKey||e.ctrlKey||e.metaKey||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;if(e.key==='PageDown'){e.preventDefault();goto(active+1)}if(e.key==='PageUp'){e.preventDefault();goto(active-1)}});
})();

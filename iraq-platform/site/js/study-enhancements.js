/* MEDIXA additive study enhancements. Preserves existing storage schema. */
(()=>{'use strict';
const panel=document.getElementById('study-panel'),content=document.getElementById('study-content');
if(!panel||!content)return;
const src=new URLSearchParams(location.search).get('file');if(!src)return;
const key='medixa.study.v1:'+new URL(src,location.href).href;
const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}};
const summary=document.createElement('div');summary.id='study-summary';summary.setAttribute('aria-label','ملخص الدراسة');
const filter=document.createElement('input');filter.id='study-filter';filter.type='search';filter.placeholder='ابحث في العناصر المحفوظة';filter.setAttribute('aria-label','بحث في أدوات الدراسة');
panel.querySelector('.tabs').after(summary);summary.after(filter);
function preview(title,body){const lines=String(body||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,20);if(!lines.length)return null;
const center=String(title||'الموضوع');const nodes=[center],edges=[];
for(const line of lines){const parts=line.split(/\s*(?:→|->|=>)\s*/).filter(Boolean);if(parts.length>1){for(let i=0;i<parts.length-1;i++){if(!nodes.includes(parts[i]))nodes.push(parts[i]);if(!nodes.includes(parts[i+1]))nodes.push(parts[i+1]);edges.push([parts[i],parts[i+1]])}}else{if(!nodes.includes(line))nodes.push(line);edges.push([center,line])}}
const visible=nodes.slice(0,18),positions=new Map();visible.forEach((n,i)=>positions.set(n,i===0?[220,160]:[220+155*Math.cos((i-1)*2*Math.PI/Math.max(1,visible.length-1)),160+117*Math.sin((i-1)*2*Math.PI/Math.max(1,visible.length-1))]));
const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 440 320');svg.setAttribute('role','img');svg.setAttribute('aria-label','خريطة مفاهيمية: '+center);
function el(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));svg.append(e);return e}
for(const [a,b] of edges){if(!positions.has(a)||!positions.has(b))continue;const [x1,y1]=positions.get(a),[x2,y2]=positions.get(b);el('line',{x1,y1,x2,y2})}
visible.forEach((n,i)=>{const [x,y]=positions.get(n);el('rect',{x:x-49,y:y-18,width:98,height:36,rx:8});el('text',{x,y:y+4,'text-anchor':'middle'}).textContent=n.length>15?n.slice(0,14)+'…':n});
const wrap=document.createElement('div');wrap.className='medixa-concept-preview';wrap.append(svg);return wrap}
function refresh(){const d=read(),count=k=>Array.isArray(d[k])?d[k].length:0;const due=(d.cards||[]).filter(c=>!c.due||c.due<=Date.now()).length;
summary.innerHTML='<strong>ملخص الدراسة</strong><div class="numbers">'+[['بطاقات',count('cards')],['مراجعة مستحقة',due],['أسئلة',count('quiz')],['ملاحظات',count('notes')],['خرائط',count('maps')],['أقنعة',count('masks')]].map(([k,v])=>'<span><b>'+v+'</b>'+k+'</span>').join('')+'</div>';
const tab=panel.querySelector('[data-study-tab].active')?.dataset.studyTab;
if(tab==='map'){const items=content.querySelectorAll('.study-item');(d.maps||[]).forEach((m,i)=>{if(items[i]&&!items[i].querySelector('.medixa-concept-preview')){const p=preview(m.title,m.body);if(p)items[i].append(p)}})}
const query=filter.value.trim().toLocaleLowerCase();content.querySelectorAll('.study-item').forEach(item=>{item.hidden=!!query&&!item.textContent.toLocaleLowerCase().includes(query)})}
new MutationObserver(refresh).observe(content,{childList:true});filter.addEventListener('input',refresh);
panel.querySelectorAll('[data-study-tab]').forEach(b=>b.addEventListener('click',()=>{filter.value='';requestAnimationFrame(refresh)}));
document.getElementById('study-launch')?.addEventListener('click',()=>requestAnimationFrame(refresh));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open')){panel.classList.remove('open');document.getElementById('study-launch')?.focus()}});
window.addEventListener('storage',e=>{if(e.key===key)refresh()});refresh();
})();

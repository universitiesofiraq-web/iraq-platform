(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let data, selected = '', reviewCursor = null, loading = false;
  const errors = { appeal_unavailable:'الاعتراض مسجل سابقاً أو المشاركة غير متاحة للاعتراض.',independent_review_required:'يجب أن يراجع الاعتراض مسؤول آخر غير صاحب القرار السابق.',unauthorized:'سجّل الدخول للمتابعة.',forbidden:'لا تملك صلاحية هذا الإجراء.',season_locked:'الموسم مقفل لهذا الإجراء، أو توجد مشاركات معلّقة أو موسم آخر مفتوح.',membership_unavailable:'تحقق من اختيار مرحلتك وتفعيل جامعتك، وأن الموسم مفتوح.',submission_unavailable:'المشاركة مسجلة سابقاً، أو انتهى وقت التحدي، أو تغيرت مرحلتك.',bad_request:'راجع الحقول والمواعيد المطلوبة.',not_configured:'الدوري غير متاح حالياً.' };
  const date = value => new Date(value).toLocaleString('ar-IQ');
  async function api(action, body) {
    const response = await fetch('/api/league/' + action, { credentials:'same-origin',cache:'no-store',
      ...(body === undefined ? {} : { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { $('login').hidden = response.status !== 401; throw Error(errors[result.error] || 'تعذر إتمام الطلب. حاول مرة أخرى.'); }
    return result;
  }
  function row(parent, title, detail, css = 'card') {
    const box = document.createElement('div'); box.className = css;
    const heading = document.createElement('strong'); heading.textContent = title;
    const paragraph = document.createElement('p'); paragraph.textContent = detail;
    box.append(heading, paragraph); parent.append(box); return box;
  }
  async function run(task) {
    if (loading) return;
    loading = true; $('message').textContent = 'جارٍ تنفيذ الطلب…';
    const buttons = [...document.querySelectorAll('button, #season')];
    const disabled = buttons.map(button => button.disabled); buttons.forEach(button => button.disabled = true);
    try { await task(); $('message').textContent = ''; }
    catch(error) { $('message').textContent = error.message; $('retry').hidden = false; }
    finally { loading = false; buttons.forEach((button,index) => button.disabled = disabled[index]); }
  }
  async function load() {
    data = await api('overview' + (selected ? '?season=' + encodeURIComponent(selected) : ''));
    $('content').hidden = false; $('retry').hidden = true;$('login').hidden=true;
    $('season').replaceChildren();
    for (const season of data.seasons) { const option = new Option(season.title,season.id); $('season').add(option); }
    $('adminForms').hidden = !data.admin;
    $('manageTab').hidden = !(data.admin || data.reviewer);
    for (const name of ['ledger','challengeList','rankList','groupList','history','hall','myGroup','groupChallenges']) $(name).replaceChildren();
    if (!data.season) { $('privacy').hidden=true;$('points').textContent='ابدأ رحلتك';$('level').textContent='';$('nextLevel').textContent='';$('lifetime').textContent='';$('myRank').textContent='';$('badges').replaceChildren();$('levelProgress').value=0; $('period').textContent = 'لا يوجد موسم بعد. يمكن للإدارة إنشاء الموسم الأول.'; $('join').hidden = true; return; }
    selected = String(data.season.id); $('season').value = selected;
    const states = {draft:'مسودة',active:'مفتوح',closed:'مغلق'};
    $('period').textContent = states[data.season.state] + ' · ' + date(data.season.starts_at) + ' — ' + date(data.season.ends_at);
    $('challengeStage').replaceChildren(new Option('جميع المراحل المشاركة',''));
    for(const st of data.stages || []) $('challengeStage').add(new Option(st.university+' · '+st.college+' · '+st.department+' · '+st.number,st.id));
    $('badges').replaceChildren();
    for(const [threshold,title] of [[20,'بداية موفقة'],[100,'مساهم نشط'],[300,'صانع أثر'],[1000,'رائد المعرفة']]) {
      const badge=document.createElement('span');badge.className='badge';
      const earned=(data.lifetime?.points || 0)>=threshold;
      badge.textContent=(earned?'✓ ':'')+title+' · '+threshold+' نقطة';badge.dataset.earned=String(earned);$('badges').append(badge);
    }
    $('lifetime').textContent = (data.lifetime?.points || 0)+' نقطة معتمدة عبر '+(data.lifetime?.seasons || 0)+' مواسم';
    $('myRank').textContent = data.myRank ? 'ترتيبك في الموسم: '+data.myRank.rank : 'ترتيبك العام يظهر عند تفعيل مشاركة اسمك.';
    for (const h of data.history || []) row($('history'),h.title+' · '+(h.state==='approved'?'اعتماد':'رفض'),h.reason+' · '+date(h.created_at),'row');
    if (!data.history?.length) row($('history'),'لا توجد قرارات بعد','ستظهر قرارات المراجعة وأسبابها هنا.');
    const points = data.me?.points || 0;
    const thresholds = [0,100,300,600,1000], names = ['مبتدئ','مثابر','متقدم','متميز','رائد'];
    const level = thresholds.filter(n => points >= n).length-1;
    $('points').textContent = points + ' نقطة هذا الموسم'; $('level').textContent = names[level];
    const next = thresholds[level+1]; $('nextLevel').textContent = next ? 'تبقى ' + (next-points) + ' نقطة للمستوى التالي' : 'بلغت أعلى مستوى في الموسم';
    $('levelProgress').value = next ? (points-thresholds[level])/(next-thresholds[level])*100 : 100;
    $('join').hidden = !!data.member || data.season.state !== 'active';
    $('privacy').hidden = !data.member; $('privacy').textContent = data.member?.public ? 'إخفاء اسمي من الترتيب' : 'إظهار اسمي في الترتيب';
    if (!data.ledger.length) row($('ledger'),'لا توجد نقاط بعد','تظهر هنا النقاط وأسباب احتسابها بعد مراجعة مشاركاتك.');
    for (const event of data.ledger) row($('ledger'),(event.delta>0?'+':'')+event.delta+' نقطة',event.reason+' · '+date(event.created_at),'row');
    for (const c of data.challenges) {
      const card = row($('challengeList'),c.title+' · '+c.points+' نقطة'+(c.target_stage?' · تحدّي مرحلة':' · تحدّي عام'),c.description+' · ينتهي '+date(c.deadline));
      if (c.submission_state) { row(card,'حالة مشاركتك',{pending:'بانتظار المراجعة',approved:'معتمدة',rejected:'مرفوضة'}[c.submission_state]+(c.review_reason?' · '+c.review_reason:''),'row');
        if (c.appeal_state) row(card,'الاعتراض',c.appeal_state==='pending'?'بانتظار مسؤول مستقل':'تمت مراجعته','row');
        if(c.submission_state==='rejected' && !c.appeal_state && data.season.state==='active') {
          const form=document.createElement('form'),label=document.createElement('label'),reason=document.createElement('textarea'),button=document.createElement('button');
          label.textContent='سبب الاعتراض (مرة واحدة لكل مشاركة)';reason.required=true;reason.maxLength=1000;label.append(reason);button.textContent='إرسال اعتراض';form.append(label,button);card.append(form);
          form.onsubmit=event=>{event.preventDefault();run(async()=>{await api('appeal',{submission_id:c.submission_id,reason:reason.value});await load();});};
        }
        continue; }
      if (!data.member || data.season.state !== 'active' || Date.now()>c.deadline) continue;
      const form = document.createElement('form'), label = document.createElement('label'), evidence = document.createElement('textarea'), button = document.createElement('button');
      label.textContent = 'وصف الإنجاز أو رابط المحتوى'; evidence.required = true; evidence.maxLength = 2000; label.append(evidence);button.textContent = 'إرسال للمراجعة';form.append(label,button);card.append(form);
      form.addEventListener('submit', event => {event.preventDefault();run(async()=>{await api('submit',{challenge_id:c.id,evidence:evidence.value});await load();});});
    }
    if (!data.challenges.length) row($('challengeList'),'لا توجد تحديات','ستظهر التحديات التي تعتمدها الإدارة هنا.');
    for(const champion of data.hall || []) row($('hall'),champion.title+' · #'+champion.rank+' '+champion.display_name,champion.points+' نقطة','row');
    if(!data.hall?.length) row($('hall'),'المواسم القادمة تصنع الأبطال','تظهر هنا النتائج بعد إغلاق الموسم.');
    for (const item of data.ranking) row($('rankList'),'#'+item.rank+' '+item.display_name+(item.mine?' · أنت':''),item.points+' نقطة','row');
    if (!data.ranking.length) row($('rankList'),'الترتيب فارغ','يظهر المشاركون الذين اختاروا مشاركة أسمائهم.');
    if(data.myGroup) {
      const g=data.myGroup;
      row($('myGroup'),'مجموعتي · المركز '+g.rank,g.score+' نقطة · '+g.participants+' عضو فعّال من '+g.members+' · نسبة النشاط '+Math.round(g.participants/g.members*100)+'٪');
    } else row($('myGroup'),'انضم إلى الموسم','تظهر مجموعتك من المرحلة المسجلة في ملفك الدراسي.');
    for(const c of data.groupChallenges || []) {
      const completed=c.completed || 0;
      const card=row($('groupChallenges'),c.title,completed+' من '+c.members+' أعضاء أكملوا التحدّي · '+c.points+' نقطة لكل إنجاز معتمد');
      const progress=document.createElement('progress');progress.max=c.members;progress.value=completed;progress.setAttribute('aria-label','إنجاز '+c.title);card.append(progress);
    }
    updateCountdown();
    for (const g of data.groups) row($('groupList'),'#'+g.rank+' '+g.university+' · '+g.college+' · '+g.department+' · المرحلة '+g.stage+(data.member?.stage_id===g.stage_id?' · مجموعتي':''),g.score+' نقطة للمجموعة · '+g.participants+' مشارك فعّال من '+g.members);
    if (!data.groups.length) row($('groupList'),'لا توجد مجموعات مشاركة','تُحدد مجموعة الطالب تلقائياً عند الانضمام.');
  }
  function updateCountdown(){
    const season=data?.season;
    if(!season){$('countdown').textContent='';return;}
    if(season.state==='closed'){$('countdown').textContent='انتهى الموسم وثُبّتت النتائج';return;}
    const now=Date.now(),before=now<season.starts_at,remaining=(before?season.starts_at:season.ends_at)-now;
    if(remaining<=0){$('countdown').textContent='انتهى استقبال المشاركات · بانتظار استكمال المراجعات';return;}
    const minutes=Math.floor(remaining/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
    $('countdown').textContent=(season.state==='draft'?'الموسم مسودة · ':'')+(before?'يبدأ بعد ':'ينتهي بعد ')+days+' يوم و'+hours+' ساعة و'+minutes%60+' دقيقة';
  }
  setInterval(updateCountdown,60000);
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click',()=>{
    document.querySelectorAll('[data-panel]').forEach(tab=>{tab.setAttribute('aria-pressed',String(tab===button));$(tab.dataset.panel).hidden=tab!==button;});
  }));
  $('season').addEventListener('change',()=>{selected=$('season').value;run(load);});
  $('retry').onclick=()=>run(load);
  $('join').onsubmit=event=>{event.preventDefault(); const f=new FormData(event.target);run(async()=>{await api('join',{season_id:data.season.id,display_name:f.get('display_name'),public:f.has('public')});await load();});};
  $('privacy').onclick=()=>run(async()=>{await api('privacy',{season_id:data.season.id,public:!data.member.public});await load();});
  $('createSeason').onsubmit=event=>{event.preventDefault();const f=new FormData(event.target);run(async()=>{const result=await api('season',{title:f.get('title'),starts_at:new Date(f.get('starts_at')).getTime(),ends_at:new Date(f.get('ends_at')).getTime()});selected=String(result.id);event.target.reset();await load();});};
  $('createChallenge').onsubmit=event=>{event.preventDefault();const f=new FormData(event.target);run(async()=>{if(!data.season)throw Error('أنشئ موسماً أولاً.');await api('challenge',{season_id:data.season.id,title:f.get('title'),description:f.get('description'),points:Number(f.get('points')),stage_id:f.get('stage_id')?Number(f.get('stage_id')):null,deadline:new Date(f.get('deadline')).getTime()});event.target.reset();await load();});};
  for(const [button,state] of [['activate','active'],['closeSeason','closed']]) $(button).onclick=()=>run(async()=>{
    if(!data.season)throw Error('اختر موسماً أولاً.');
    if(!confirm(state==='active'?'فتح الموسم وتثبيت التحديات والنقاط؟':'إغلاق الموسم وتثبيت النتائج؟'))return;
    await api('season-state',{season_id:data.season.id,state});await load();
  });
  async function reviews(append=false){
    const result=await api('review?state='+encodeURIComponent($('reviewState').value)+(append&&reviewCursor?'&after='+reviewCursor:''));
    if(!append)$('reviewList').replaceChildren();reviewCursor=result.next;$('moreReviews').hidden=!reviewCursor;
    for(const item of result.items){
      const card=row($('reviewList'),item.display_name+' · '+item.title,item.evidence+' · '+item.state+(item.appeal_state==='pending'?' · اعتراض: '+item.appeal_reason:''));
      const form=document.createElement('form'),label=document.createElement('label'),reason=document.createElement('input'),select=document.createElement('select'),button=document.createElement('button');
      label.textContent='سبب القرار';reason.required=true;reason.maxLength=500;label.append(reason);select.setAttribute('aria-label','القرار');select.add(new Option('اعتماد','approved'));select.add(new Option('رفض أو إلغاء الاعتماد','rejected'));button.textContent='حفظ القرار';form.append(label,select,button);card.append(form);
      form.onsubmit=event=>{event.preventDefault();run(async()=>{await api('decision',{submission_id:item.id,state:select.value,reason:reason.value});await reviews();await load();});};
    }
    if(!result.items.length&&!append)row($('reviewList'),'لا توجد مشاركات في هذه الصفحة','استخدم المزيد إذا كان هناك صفحات أخرى ضمن نطاقك.');
  }
  $('reviews').onclick=()=>run(()=>reviews());$('moreReviews').onclick=()=>run(()=>reviews(true));
  run(load);
})();

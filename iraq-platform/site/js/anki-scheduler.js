/* MEDIXA Anki-style SM-2 scheduler. No external dependency; preserves legacy cards. */
(function(root){'use strict';
const DAY=86400000, MIN=60000;
const num=(n,f)=>Number.isFinite(Number(n))?Number(n):f;
const status=c=>c.srsState||((num(c.reviews,0)>0)?'review':'new');
const isDue=(c,now=Date.now())=>!Number(c.due)||Number(c.due)<=now;
function grade(card,rating,now=Date.now()){
 if(!['again','hard','good','easy'].includes(rating))throw Error('Invalid rating');
 const c={...card},state=status(c),ease=Math.max(1.3,num(c.ease,2.5)),iv=Math.max(0,num(c.interval,0));
 let nextState=state,interval=iv,due,easeNext=ease,reps=Math.max(0,num(c.repetitions,0)),lapses=Math.max(0,num(c.lapses,0));
 if(rating==='again'){
  nextState='learning';interval=0;due=now+MIN;lapses++;reps=0;easeNext=Math.max(1.3,ease-.2);
 }else if(state==='new'||state==='learning'){
  if(rating==='hard'){nextState='learning';interval=0;due=now+6*MIN;easeNext=Math.max(1.3,ease-.15)}
  else if(rating==='good'&&state==='new'){nextState='learning';interval=0;due=now+10*MIN}
  else {nextState='review';interval=rating==='easy'?4:1;due=now+interval*DAY;reps=1;if(rating==='easy')easeNext+=.15}
 }else{
  if(rating==='hard'){interval=Math.max(1,Math.round(iv*1.2));easeNext=Math.max(1.3,ease-.15)}
  else if(rating==='good')interval=Math.max(iv+1,Math.round(iv*ease));
  else {interval=Math.max(iv+1,Math.round(iv*ease*1.3));easeNext+=.15}
  due=now+interval*DAY;reps++;
 }
 return {srsState:nextState,interval,due,ease:Math.round(easeNext*100)/100,repetitions:reps,lapses,reviews:num(c.reviews,0)+1,lastReviewed:now,lastRating:rating};
}
function label(card,rating,now=Date.now()){
 const ms=grade(card,rating,now).due-now;
 if(ms<3600000)return Math.round(ms/MIN)+'د';
 if(ms<DAY)return Math.round(ms/3600000)+'س';
 return Math.round(ms/DAY)+'ي';
}
const api={grade,isDue,status,label};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.MedixaAnki=api;
})(typeof window!=='undefined'?window:globalThis);

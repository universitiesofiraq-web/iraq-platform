/* MEDIXA Step 42: guarded localStorage access for study modules.
   - Never overwrite a stored value that could not be read or parsed (corrupted originals stay byte-identical).
   - Refuse to write when the stored value changed since this page last read or wrote it (another tab, or a backup
     import in this tab). The student is asked to reload instead of silently losing the newer data.
   - Every write is read back; on a mismatch the previous bytes are restored.
   localStorage has no compare-and-swap, so two tabs writing in the same instant can still race; this narrows the
   window to a single synchronous read-then-write. */
(()=>{'use strict';
const MSG={
  saved:'محفوظ على هذا الجهاز ✓',
  corrupt:'البيانات المحفوظة لهذا الملف تالفة؛ لم نكتب فوقها، والتعديلات الجديدة لن تُحفظ.',
  unreadable:'تعذرت قراءة التخزين المحلي؛ لن نكتب فوق البيانات القديمة.',
  conflict:'تغيّرت البيانات في تبويب آخر أو من نسخة احتياطية؛ أعد تحميل الصفحة قبل التعديل حتى لا تضيع.',
  failed:'تعذر الحفظ (مساحة التخزين غالباً)؛ بياناتك القديمة لم تتغير.'
};
function open(storage,key,{fallback,valid}={}){
  const make=()=>typeof fallback==='function'?fallback():fallback;
  let state='ok',known,value=make(),raw=null;
  try{raw=storage.getItem(key)}catch{state='unreadable'}
  if(state==='ok'){
    known=raw;
    if(raw!==null){let parsed,ok=true;try{parsed=JSON.parse(raw)}catch{ok=false}
      if(ok&&(!valid||valid(parsed)))value=parsed;else state='corrupt'}
  }
  let conflicted=false;
  return {
    get state(){return conflicted?'conflict':state},
    value,
    /* Returns 'saved' | 'corrupt' | 'unreadable' | 'conflict' | 'failed'. */
    write(obj){
      if(state!=='ok')return state;
      if(conflicted)return 'conflict';
      let current;try{current=storage.getItem(key)}catch{return 'failed'}
      if(current!==known){conflicted=true;return 'conflict'}
      let payload;try{payload=JSON.stringify(obj)}catch{return 'failed'}
      try{storage.setItem(key,payload);if(storage.getItem(key)!==payload)throw Error('verify')}
      catch{try{if(storage.getItem(key)!==current){current===null?storage.removeItem(key):storage.setItem(key,current)}}catch{}return 'failed'}
      known=payload;return 'saved';
    },
    /* True if storage no longer holds what this page last read or wrote. */
    changed(){try{return storage.getItem(key)!==known}catch{return true}}
  };
}
window.MedixaGuard={open,MSG};
})();

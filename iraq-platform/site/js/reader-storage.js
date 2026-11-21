// Pages stamps the owner from the session on each private HTML response.
const ReaderStorage = (() => {
  const owner = document.documentElement.dataset.readerOwner;
  const verified = owner === 'guest' || /^[1-9]\d*$/.test(owner || '');
  const prefix = 'iq.reader.v2:' + owner + ':';
  function name(key) {
    if (!verified) throw new Error('Reader session unavailable');
    // Theme is a site-wide device preference.
    return key === 'ms.theme' ? key : prefix + key;
  }
  function scoped(store) {
    return {
      getItem(key) { return store.getItem(name(key)); },
      setItem(key, value) { store.setItem(name(key), value); },
      removeItem(key) { store.removeItem(name(key)); }
    };
  }
  function refresh() {
    document.documentElement.style.visibility = 'hidden';
    location.reload();
  }
  addEventListener('storage', event => {
    if (event.key === 'iq.reader.session-change') refresh();
  });
  addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  if (!verified) {
    addEventListener('DOMContentLoaded', () => {
      const message = document.createElement('p');
      message.textContent = 'تعذّر التحقق من الحساب. اتصل بالإنترنت ثم أعد فتح الصفحة.';
      document.body.replaceChildren(message);
    });
  }
  return {owner, verified, scoped, name};
})();

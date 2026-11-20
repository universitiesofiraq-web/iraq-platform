// A position belongs to the source PDF, independent of zoom, personal margins and blank pages.
(() => {
  const reader = window.MedixaStudio?.reader;
  const menu = document.getElementById('st-docmenu');
  const source = new URLSearchParams(location.search).get('file');
  if (!reader || !menu || !source) return;
  let file;
  try { file = new URL(source, location.href); } catch { return; }
  if (file.origin !== location.origin || file.username || file.password || file.search || file.hash ||
      !/^\/(?:api\/file\/[^/]+|files\/.+\.pdf)$/i.test(file.pathname)) return;

  const button = (label) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    return element;
  };
  const share = button('شارك هذا الموضع');
  share.disabled = true;
  menu.prepend(share);
  const notice = document.createElement('aside');
  notice.className = 'lecture-position-notice';
  notice.hidden = true;
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  const cancel = button('إلغاء');
  notice.append(message, cancel);
  document.body.append(notice);
  let marker;
  function stop() {
    document.querySelectorAll('.lecture-position-target').forEach(el => el.remove());
    notice.hidden = true;
  }
  cancel.onclick = stop;
  document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); });

  function mark(page, x, y) {
    marker?.remove();
    const area = document.createElement('div');
    area.className = 'lecture-position-area';
    const dot = document.createElement('span');
    dot.className = 'lecture-position-dot';
    dot.style.left = x * 100 + '%';
    dot.style.top = y * 100 + '%';
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'الموضع المشار إليه');
    area.append(dot);
    page.el.append(area);
    marker = area;
    return dot;
  }
  function restore() {
    stop();
    marker?.remove();
    const params = new URLSearchParams(location.hash.slice(1));
    const page = reader.byId.get(Number(params.get('page')));
    if (!page || page.kind !== 'src') return;
    const coord = key => {
      const raw = params.get(key);
      return raw && /^(0(\.\d+)?|1(\.0+)?)$/.test(raw) ? Number(raw) : NaN;
    };
    const x = coord('x'), y = coord('y');
    if (!Number.isFinite(x) || !Number.isFinite(y)) { reader.goto(page.id, false); return; }
    mark(page, x, y).scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
  }
  async function send(page, x, y) {
    stop();
    mark(page, x, y);
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('file', source);
    url.hash = new URLSearchParams({page: page.id, x: x.toFixed(5), y: y.toFixed(5)});
    if (navigator.share) {
      try { await navigator.share({url: url.href}); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url.href);
      message.textContent = 'تم نسخ رابط الموضع في الصفحة ' + page.id;
      cancel.textContent = 'إغلاق';
      notice.hidden = false;
    } catch { window.prompt('انسخ رابط الموضع', url.href); }
  }
  share.onclick = () => {
    stop();
    cancel.textContent = 'إلغاء';
    message.textContent = 'اضغط على الموضع الذي تريد مشاركته في المحاضرة';
    notice.hidden = false;
    for (const page of reader.pages) {
      if (page.kind !== 'src') continue;
      const target = button('');
      target.className = 'lecture-position-area lecture-position-target';
      target.setAttribute('aria-label', 'مشاركة موضع في الصفحة ' + page.id);
      target.onclick = event => {
        const r = target.getBoundingClientRect();
        const relative = (offset, size) => Math.min(1, Math.max(0, offset / size));
        send(page, event.detail ? relative(event.clientX - r.left, r.width) : 0.5,
          event.detail ? relative(event.clientY - r.top, r.height) : 0.5);
      };
      page.el.append(target);
    }
  };
  function ready() { share.disabled = false; if (location.hash) requestAnimationFrame(restore); }
  reader.on('opened', ready);
  if (reader.nSources && reader.pages.length) ready();
  addEventListener('hashchange', restore);
})();

/* PDF Creator — click anywhere on an A4 page, type Tamil or English,
   download the page as a PDF or an image. No build step, no backend. */
(() => {
  'use strict';

  // A4 in CSS pixels (96 dpi) and in PDF points.
  const A4_PX = { w: 794, h: 1123 };
  const A4_PT = { w: 595.28, h: 841.89 };
  const LINE_HEIGHT = 1.25;
  const PAD_X = 4;                 // room for the caret on each side of a textarea
  const STORAGE_KEY = 'pdf-creator.doc.v1';

  const FONTS = [
    ['Noto Sans Tamil', 'Noto Sans Tamil'],
    ['Catamaran', 'Catamaran'],
    ['Mukta Malar', 'Mukta Malar'],
    ['Hind Madurai', 'Hind Madurai'],
    ['Baloo Thambi 2', 'Baloo Thambi'],
    ['Anek Tamil', 'Anek Tamil'],
    ['Arima', 'Arima'],
    ['Noto Serif Tamil', 'Noto Serif Tamil'],
    ['Tiro Tamil', 'Tiro Tamil'],
    ['Pavanam', 'Pavanam'],
    ['Kavivanar', 'Kavivanar (handwriting)'],
    ['Coiny', 'Coiny (display)'],
  ];
  const COLORS = ['#111111', '#d11a2a', '#1d4ed8', '#15803d', '#ea580c', '#7e22ce'];

  // Ready-made Tamil words, so a phone without a Tamil keyboard only has to type the date.
  const DAYS_TA = ['ஞாயிற்றுக்கிழமை', 'திங்கட்கிழமை', 'செவ்வாய்க்கிழமை', 'புதன்கிழமை', 'வியாழக்கிழமை', 'வெள்ளிக்கிழமை', 'சனிக்கிழமை'];
  const WORDS = ['விடுமுறை', ...[1, 2, 3, 4, 5, 6, 0].map((d) => `(${DAYS_TA[d]})`), '&'];

  const SAMPLE = {
    orientation: 'portrait',
    boxes: [
      { x: 397, y: 263, size: 62, text: '16.09.2026\n(புதன்கிழமை)\n&\n17.09.2026\n(வியாழக்கிழமை)', role: 'dates' },
      { x: 397, y: 765, size: 76, text: 'விடுமுறை', role: 'title' },
    ],
  };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    workspace: $('#workspace'), pageWrap: $('#page-wrap'), page: $('#page'), hint: $('#hint'),
    measure: $('#measure'), toast: $('#toast'),
    fontFamily: $('#font-family'), fontSize: $('#font-size'), fontRange: $('#font-range'),
    bold: $('#bold'), align: $('#align'), swatches: $('#swatches'), colorPick: $('#color-pick'),
    centerX: $('#center-x'), del: $('#delete'), orient: $('#orient'),
    sample: $('#btn-sample'), hintSample: $('#hint-sample'), clear: $('#btn-clear'),
    share: $('#btn-share'), png: $('#btn-png'), pdf: $('#btn-pdf'),
    words: $('#words'), dateChip: $('#date-chip'), hintDate: $('#hint-date'), datePick: $('#date-pick'),
  };

  const state = {
    orientation: 'portrait',
    boxes: [],            // { id, x, y, text, font, size, weight, align, color }
    selectedId: null,
    scale: 1,
    // Style of the selected box, and the style the next new box inherits.
    style: { font: 'Noto Sans Tamil', size: 48, weight: 700, align: 'center', color: '#111111' },
  };
  const nodes = new Map(); // box id -> .box element
  let uid = 1;

  // ---------- helpers ----------
  const pageSize = () => state.orientation === 'portrait' ? A4_PX : { w: A4_PX.h, h: A4_PX.w };
  const pagePt = () => state.orientation === 'portrait' ? A4_PT : { w: A4_PT.h, h: A4_PT.w };
  const fontStack = (font) => `"${font}", "Noto Sans Tamil", sans-serif`;
  const fontSpec = (b) => `${b.weight} ${b.size}px ${fontStack(b.font)}`;
  const lines = (text) => text.split('\n');
  const selected = () => state.boxes.find((b) => b.id === state.selectedId) || null;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  // ---------- persistence ----------
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          orientation: state.orientation, style: state.style, boxes: state.boxes,
        }));
      } catch { /* private mode etc. — editing still works, it just won't persist */ }
    }, 250);
  }
  function load() {
    try {
      const doc = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (doc && Array.isArray(doc.boxes)) return doc;
    } catch { /* ignore corrupt data */ }
    return null;
  }

  // ---------- page scale ----------
  function layout() {
    const { w, h } = pageSize();
    const availW = el.workspace.clientWidth - 24;
    const availH = el.workspace.clientHeight - 40;
    const fitWidthOnly = window.innerWidth < 720;      // phones: fit width, scroll vertically
    const s = clamp(fitWidthOnly ? availW / w : Math.min(availW / w, availH / h), 0.2, 1.25);
    state.scale = s;
    el.page.style.width = `${w}px`;
    el.page.style.height = `${h}px`;
    el.page.style.transform = `scale(${s})`;
    el.page.style.setProperty('--inv', 1 / s);
    el.pageWrap.style.width = `${w * s}px`;
    el.pageWrap.style.height = `${h * s}px`;
  }

  // ---------- text boxes ----------
  function measureWidth(b) {
    const m = el.measure;
    m.style.font = fontSpec(b);
    m.style.lineHeight = LINE_HEIGHT;
    m.textContent = b.text;
    return m.getBoundingClientRect().width;
  }

  // Size the textarea to its content and anchor it so that box.x is the
  // left / centre / right edge of the text depending on its alignment.
  function layoutBox(b) {
    const node = nodes.get(b.id);
    if (!node) return;
    const ta = node.querySelector('textarea');
    ta.style.font = fontSpec(b);
    ta.style.lineHeight = LINE_HEIGHT;
    ta.style.color = b.color;
    ta.style.textAlign = b.align;
    if (ta.value !== b.text) ta.value = b.text;
    const w = Math.max(measureWidth(b), b.size * 0.5);
    const h = lines(b.text).length * b.size * LINE_HEIGHT;
    ta.style.width = `${w + PAD_X * 2 + 1}px`;
    ta.style.height = `${h}px`;
    const anchor = b.align === 'center' ? w / 2 : b.align === 'right' ? w : 0;
    node.style.left = `${b.x - anchor - PAD_X}px`;
    node.style.top = `${b.y}px`;
  }

  function mountBox(b) {
    const node = document.createElement('div');
    node.className = 'box';
    node.innerHTML = `
      <div class="box-tools">
        <button type="button" class="grip" title="Drag to move" aria-label="Move">⠿</button>
        <button type="button" class="box-del" title="Delete" aria-label="Delete">✕</button>
      </div>
      <textarea class="box-text" wrap="off" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Text"></textarea>`;
    const ta = node.querySelector('textarea');
    ta.value = b.text;
    ta.addEventListener('input', () => { b.text = ta.value; layoutBox(b); save(); });
    ta.addEventListener('focus', () => select(b.id));
    ta.addEventListener('blur', () => { b.caret = ta.selectionEnd; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ta.blur(); deselect(); }
    });
    // With a mouse, an unselected box can be dragged straight away; a plain click edits it.
    ta.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && state.selectedId !== b.id) startDrag(e, b, ta);
    });
    node.querySelector('.grip').addEventListener('pointerdown', (e) => startDrag(e, b));
    const del = node.querySelector('.box-del');
    del.addEventListener('pointerdown', (e) => e.preventDefault());
    del.addEventListener('click', () => removeBox(b.id));
    el.page.appendChild(node);
    nodes.set(b.id, node);
    layoutBox(b);
  }

  function startDrag(e, b, focusAfterClick) {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
    let moved = false;
    try { target.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      b.x = Math.round(ox + (ev.clientX - sx) / state.scale);
      b.y = Math.round(oy + (ev.clientY - sy) / state.scale);
      layoutBox(b);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (moved) { save(); return; }
      select(b.id);
      if (focusAfterClick) focusAfterClick.focus();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  function addBox(x, y, overrides = {}) {
    const s = state.style;
    const b = { id: uid++, x, y, text: '', font: s.font, size: s.size, weight: s.weight, align: s.align, color: s.color, ...overrides };
    state.boxes.push(b);
    mountBox(b);
    el.hint.hidden = true;
    return b;
  }

  function removeBox(id) {
    const i = state.boxes.findIndex((b) => b.id === id);
    if (i < 0) return;
    state.boxes.splice(i, 1);
    nodes.get(id)?.remove();
    nodes.delete(id);
    if (state.selectedId === id) state.selectedId = null;
    el.hint.hidden = state.boxes.length > 0;
    syncToolbar();
    save();
  }

  function select(id) {
    if (state.selectedId === id) return;
    const prev = selected();
    state.selectedId = id;
    if (prev && !prev.text.trim()) removeBox(prev.id);   // never keep empty boxes around
    nodes.forEach((n, key) => n.classList.toggle('is-selected', key === id));
    const b = selected();
    if (b) Object.assign(state.style, { font: b.font, size: b.size, weight: b.weight, align: b.align, color: b.color });
    syncToolbar();
  }

  function deselect() {
    const b = selected();
    state.selectedId = null;
    if (document.activeElement?.classList.contains('box-text')) document.activeElement.blur();
    if (b) {
      if (!b.text.trim()) removeBox(b.id);
      else nodes.get(b.id)?.classList.remove('is-selected');
    }
    syncToolbar();
  }

  // Click on empty paper → new text box right there.
  el.page.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.box, button')) return;
    const sx = e.clientX, sy = e.clientY;
    window.addEventListener('pointerup', (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) return;
      const r = el.page.getBoundingClientRect();
      const px = (ev.clientX - r.left) / state.scale;
      const py = (ev.clientY - r.top) / state.scale;
      const { w } = pageSize();
      const align = px < w * 0.28 ? 'left' : px > w * 0.72 ? 'right' : 'center';
      const b = addBox(Math.round(px), Math.round(py - state.style.size * LINE_HEIGHT / 2), { align });
      select(b.id);
      nodes.get(b.id).querySelector('textarea').focus();
    }, { once: true });
  });

  // Click on the grey desk → just deselect.
  el.workspace.addEventListener('pointerdown', (e) => {
    if (e.target === el.workspace || e.target === el.pageWrap) deselect();
  });

  // ---------- toolbar ----------
  function applyStyle(patch) {
    Object.assign(state.style, patch);
    const b = selected();
    if (b) { Object.assign(b, patch); layoutBox(b); save(); }
    syncToolbar();
  }

  function syncToolbar() {
    const s = state.style;
    el.fontFamily.value = s.font;
    el.fontSize.value = s.size;
    el.fontRange.value = clamp(s.size, +el.fontRange.min, +el.fontRange.max);
    el.bold.setAttribute('aria-pressed', String(s.weight >= 700));
    el.align.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x.dataset.align === s.align));
    const preset = COLORS.includes(s.color);
    el.swatches.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x.dataset.color === s.color));
    el.colorPick.parentElement.classList.toggle('is-on', !preset);
    el.colorPick.value = s.color;
    const has = !!selected();
    el.centerX.disabled = !has;
    el.del.disabled = !has;
    el.orient.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x.dataset.orient === state.orientation));
  }

  function setSize(n) {
    applyStyle({ size: clamp(Math.round(n) || 8, 8, 300) });
  }

  function setOrientation(o) {
    if (state.orientation === o) return;
    state.orientation = o;
    layout();
    syncToolbar();
    save();
  }

  function setDocument(doc) {
    nodes.forEach((n) => n.remove());
    nodes.clear();
    state.boxes = [];
    state.selectedId = null;
    state.orientation = doc.orientation === 'landscape' ? 'landscape' : 'portrait';
    if (doc.style) Object.assign(state.style, doc.style);
    layout();
    (doc.boxes || []).forEach(({ id, ...rest }) => addBox(rest.x, rest.y, rest));
    el.hint.hidden = state.boxes.length > 0;
    syncToolbar();
    save();
  }

  function loadSample() {
    const style = { ...state.style, font: 'Noto Sans Tamil', weight: 700, align: 'center', color: '#111111' };
    setDocument({ ...SAMPLE, style });
    toast('Sample loaded — click any text to edit it');
  }

  function clearAll() {
    if (state.boxes.length && !confirm('Clear the whole page?')) return;
    setDocument({ orientation: state.orientation, boxes: [] });
  }

  // Insert a word at the caret of the selected box, or start a new centred box with it.
  function insertText(str) {
    let b = selected();
    if (!b) {
      const { w, h } = pageSize();
      const lh = state.style.size * LINE_HEIGHT;
      const lowest = state.boxes.reduce((m, x) => Math.max(m, x.y + lines(x.text).length * x.size * LINE_HEIGHT), 0);
      const y = state.boxes.length ? Math.min(lowest + 40, h - lh) : h / 2 - lh / 2;
      b = addBox(Math.round(w / 2), Math.round(y), { align: 'center' });
      select(b.id);
    }
    const ta = nodes.get(b.id).querySelector('textarea');
    const pos = document.activeElement === ta ? ta.selectionEnd : Math.min(b.caret ?? ta.value.length, ta.value.length);
    const before = ta.value.slice(0, pos);
    const text = (before && !/[\s(]$/.test(before) ? ' ' : '') + str;
    ta.value = before + text + ta.value.slice(pos);
    b.text = ta.value;
    b.caret = pos + text.length;
    ta.focus();
    ta.setSelectionRange(b.caret, b.caret);
    layoutBox(b);
    save();
  }

  WORDS.forEach((word) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = word;
    chip.addEventListener('click', () => insertText(word));
    el.words.appendChild(chip);
  });

  // ---------- leave notice from a date ----------
  // Picking a date builds the same layout as the sample notice: the dates block
  // (62px) and the விடுமுறை title (76px), centred as a pair. Each further date
  // is appended with an "&". Text edits are kept; only positions are redone.
  const NOTICE_STYLE = { font: 'Noto Sans Tamil', weight: 700, align: 'center', color: '#111111' };
  const noticeBox = (role) => state.boxes.find((b) => b.role === role);

  function addNoticeDate(y, m, d) {
    const date = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
    const entry = `${date}\n(${DAYS_TA[new Date(y, m - 1, d).getDay()]})`;
    const { w, h } = pageSize();
    const cx = Math.round(w / 2);
    let dates = noticeBox('dates');
    const isNew = !dates;
    if (dates) dates.text = dates.text.trim() ? `${dates.text.replace(/\s+$/, '')}\n&\n${entry}` : entry;
    else dates = addBox(cx, 0, { ...NOTICE_STYLE, size: 62, text: entry, role: 'dates' });
    const title = noticeBox('title') || addBox(cx, 0, { ...NOTICE_STYLE, size: 76, text: 'விடுமுறை', role: 'title' });

    const gap = 115;
    const h1 = lines(dates.text).length * dates.size * LINE_HEIGHT;
    const h2 = lines(title.text).length * title.size * LINE_HEIGHT;
    const top = Math.max(40, Math.round((h - (h1 + gap + h2)) / 2));
    Object.assign(dates, { x: cx, y: top });
    Object.assign(title, { x: cx, y: top + h1 + gap });
    layoutBox(dates);
    layoutBox(title);
    select(dates.id);
    save();
    toast(isNew ? 'Notice ready — add another date, or tap the text to edit' : 'Date added');
  }

  function openDatePicker() {
    try { el.datePick.showPicker(); } catch { el.datePick.focus(); el.datePick.click(); }
  }
  el.dateChip.addEventListener('click', openDatePicker);
  el.hintDate.addEventListener('click', openDatePicker);
  el.datePick.addEventListener('change', () => {
    const [y, m, d] = el.datePick.value.split('-').map(Number);
    el.datePick.value = '';
    if (y) addNoticeDate(y, m, d);
  });

  // Toolbar buttons must not steal focus from the textarea being edited.
  document.querySelectorAll('.toolbar button, .topbar button, .words button').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
  });

  FONTS.forEach(([family, label]) => {
    const opt = document.createElement('option');
    opt.value = family;
    opt.textContent = label;
    opt.style.fontFamily = fontStack(family);
    el.fontFamily.appendChild(opt);
  });
  el.fontFamily.addEventListener('change', () => applyStyle({ font: el.fontFamily.value }));

  COLORS.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.color = c;
    btn.style.background = c;
    btn.title = c;
    btn.addEventListener('click', () => applyStyle({ color: c }));
    el.swatches.insertBefore(btn, el.colorPick.parentElement);
  });
  el.colorPick.addEventListener('input', () => applyStyle({ color: el.colorPick.value }));

  el.fontSize.addEventListener('change', () => setSize(+el.fontSize.value));
  el.fontSize.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.fontSize.blur(); });
  el.fontRange.addEventListener('input', () => setSize(+el.fontRange.value));
  document.querySelectorAll('.stepper button').forEach((btn) => {
    btn.addEventListener('click', () => setSize(state.style.size + +btn.dataset.step));
  });
  el.bold.addEventListener('click', () => applyStyle({ weight: state.style.weight >= 700 ? 400 : 700 }));
  el.align.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) applyStyle({ align: btn.dataset.align });
  });
  el.centerX.addEventListener('click', () => {
    const b = selected();
    if (!b) return;
    b.x = Math.round(pageSize().w / 2);
    applyStyle({ align: 'center' });
  });
  el.del.addEventListener('click', () => { if (state.selectedId) removeBox(state.selectedId); });
  el.orient.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) setOrientation(btn.dataset.orient);
  });
  el.sample.addEventListener('click', loadSample);
  el.hintSample.addEventListener('click', loadSample);
  el.clear.addEventListener('click', clearAll);

  document.addEventListener('keydown', (e) => {
    const editing = document.activeElement?.classList.contains('box-text');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); exportPdf(); }
    else if (!editing && state.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (document.activeElement?.tagName === 'INPUT') return;
      e.preventDefault();
      removeBox(state.selectedId);
    } else if (e.key === 'Escape') deselect();
  });

  // ---------- export ----------
  // Draws the page onto a canvas at `k` × the on-screen size, line by line,
  // using the same fonts and line-height as the editor so it matches exactly.
  async function renderCanvas(k) {
    const { w, h } = pageSize();
    const boxes = state.boxes.filter((b) => b.text.trim());
    await document.fonts.ready;
    await Promise.all(boxes.map((b) => document.fonts.load(fontSpec(b), b.text).catch(() => {})));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(k, k);
    ctx.textBaseline = 'alphabetic';
    for (const b of boxes) {
      ctx.font = fontSpec(b);
      ctx.fillStyle = b.color;
      ctx.textAlign = b.align;
      const m = ctx.measureText('Ag');
      const asc = m.fontBoundingBoxAscent || b.size * 0.9;
      const desc = m.fontBoundingBoxDescent || b.size * 0.25;
      const lh = b.size * LINE_HEIGHT;
      const baseline = (lh - asc - desc) / 2 + asc;    // same half-leading rule the browser uses
      lines(b.text).forEach((line, i) => {
        if (line) ctx.fillText(line, b.x, b.y + i * lh + baseline);
      });
    }
    return canvas;
  }

  const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality);
  });

  // A one-page PDF that simply places a JPEG on an A4 sheet — small enough to
  // write by hand, so there is no PDF library to load.
  function buildPdf(jpeg, imgW, imgH) {
    const { w, h } = pagePt();
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (c) => { const bytes = typeof c === 'string' ? enc.encode(c) : c; chunks.push(bytes); pos += bytes.length; };
    const obj = (n, ...body) => { offsets[n] = pos; push(`${n} 0 obj\n`); body.forEach(push); push('\nendobj\n'); };
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(5, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
    obj(6, '<< /Producer (PDF Creator) >>');
    const xref = pos;
    push('xref\n0 7\n0000000000 65535 f \n');
    for (let i = 1; i <= 6; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function fileStem() {
    const first = state.boxes.find((b) => b.text.trim());
    const line = first ? lines(first.text).find((l) => l.trim()) : '';
    const stem = (line || '').trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 40).trim();
    return stem || 'notice';
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function withBusy(btn, fn) {
    if (btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    try { await fn(); } catch (err) { console.error(err); toast('Something went wrong, please try again'); }
    finally { btn.classList.remove('is-busy'); }
  }

  function exportPdf() {
    if (!state.boxes.some((b) => b.text.trim())) { toast('Type something on the page first'); return; }
    withBusy(el.pdf, async () => {
      const k = 2480 / A4_PX.w;                        // ≈ 300 dpi
      const canvas = await renderCanvas(k);
      const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
      download(buildPdf(jpeg, canvas.width, canvas.height), `${fileStem()}.pdf`);
      toast('PDF downloaded');
    });
  }

  function exportPng() {
    if (!state.boxes.some((b) => b.text.trim())) { toast('Type something on the page first'); return; }
    withBusy(el.png, async () => {
      const canvas = await renderCanvas(2);
      download(await toBlob(canvas, 'image/png'), `${fileStem()}.png`);
      toast('Image downloaded');
    });
  }

  function shareImage() {
    if (!state.boxes.some((b) => b.text.trim())) { toast('Type something on the page first'); return; }
    withBusy(el.share, async () => {
      const canvas = await renderCanvas(2);
      const file = new File([await toBlob(canvas, 'image/png')], `${fileStem()}.png`, { type: 'image/png' });
      try { await navigator.share({ files: [file], title: fileStem() }); }
      catch (err) { if (err.name !== 'AbortError') throw err; }
    });
  }

  el.pdf.addEventListener('click', exportPdf);
  el.png.addEventListener('click', exportPng);
  el.share.addEventListener('click', shareImage);
  try {
    const probe = new File([new Blob(['x'])], 'x.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) el.share.hidden = false;
  } catch { /* no Web Share — the button stays hidden */ }

  // ---------- boot ----------
  setDocument(load() || { orientation: 'portrait', boxes: [] });
  window.addEventListener('resize', () => { layout(); });
  // Web fonts arrive after first paint; re-measure every box once they land.
  document.fonts.addEventListener('loadingdone', () => state.boxes.forEach(layoutBox));
  document.fonts.ready.then(() => state.boxes.forEach(layoutBox));

  window.PDFCreator = { state, renderCanvas, buildPdf, toBlob, exportPdf, exportPng, loadSample, insertText, addNoticeDate };
})();

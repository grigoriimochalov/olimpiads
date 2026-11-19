'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DAY = 86400000;
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysTo = d => Math.round((d - today()) / DAY);
const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const fmtY = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const iso = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };

let META = {}, ITEMS = [], DER = new Map();
const favs = new Set(read('olimplist.favs', []));
let views = read('olimplist.views', []);
const state = { q: '', subjects: new Set(), levels: new Set(), grade: 0, status: 'all', sort: 'deadline', favOnly: false, hideEnded: false };
let current = null;

function derive(it) {
  const now = today();
  const st = [...it.stages].sort((a, b) => pd(a.start) - pd(b.start));
  const open = st.some(s => pd(s.start) <= now && now <= pd(s.end));
  const ended = st.every(s => pd(s.end) < now);
  const future = st.filter(s => pd(s.start) > now);
  const soon = !open && !ended && future.length > 0 && daysTo(pd(future[0].start)) <= 30;
  const dl = st.filter(s => pd(s.end) >= now).sort((a, b) => pd(a.end) - pd(b.end))[0] || null;
  const nextDate = dl ? pd(dl.end) : (future[0] ? pd(future[0].start) : null);
  return {
    st, open, ended, dl, nextDate,
    nextDays: nextDate ? daysTo(nextDate) : null,
    status: open ? 'open' : ended ? 'ended' : soon ? 'soon' : 'later'
  };
}
const urg = d => d == null ? 'none' : d <= 7 ? 'red' : d <= 30 ? 'amber' : 'blue';
const urgColor = u => u === 'red' ? 'var(--red)' : u === 'amber' ? 'var(--gold)' : u === 'blue' ? 'var(--blue)' : 'var(--muted)';
const daysLabel = d => d == null ? '—' : d <= 0 ? 'сегодня' : `${d} дн.`;

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = ITEMS.filter(it => {
    const d = DER.get(it.id);
    if (q && !(it.name + ' ' + it.organizer + ' ' + it.subjects.join(' ')).toLowerCase().includes(q)) return false;
    if (state.subjects.size && !it.subjects.some(s => state.subjects.has(s))) return false;
    if (state.levels.size && !state.levels.has(it.level)) return false;
    if (state.grade && !it.grades.includes(state.grade)) return false;
    if (state.status !== 'all' && d.status !== state.status) return false;
    if (state.favOnly && !favs.has(it.id)) return false;
    if (state.hideEnded && d.status === 'ended') return false;
    return true;
  });
  const by = {
    deadline: (a, b) => (DER.get(a.id).nextDays ?? 9999) - (DER.get(b.id).nextDays ?? 9999),
    level: (a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'),
    name: (a, b) => a.name.localeCompare(b.name, 'ru')
  }[state.sort];
  return list.sort(by);
}

function cardHTML(it, i) {
  const d = DER.get(it.id), u = urg(d.nextDays);
  const g = it.grades;
  return `<article class="card lv${it.level}" style="animation-delay:${Math.min(i * 45, 360)}ms">
    <div class="card-top"><span class="lv lv${it.level}">Уровень ${ROMAN[it.level]}</span>
      <button class="star ${favs.has(it.id) ? 'on' : ''}" data-fav="${it.id}" aria-label="В избранное">★</button></div>
    <h3>${esc(it.name)}</h3><p class="org">${esc(it.organizer)}</p>
    <div class="subj">${it.subjects.slice(0, 4).map(s => `<span>${esc(s)}</span>`).join('')}${it.subjects.length > 4 ? `<span>+${it.subjects.length - 4}</span>` : ''}</div>
    <div class="meta"><span>Классы ${g[0]}–${g[g.length - 1]}</span><span class="ben">${it.bvi ? 'БВИ / 100 баллов' : '100 баллов ЕГЭ'}</span></div>
    <div class="next urg-${u}"><b>${daysLabel(d.nextDays)}</b><span>${d.dl ? 'до конца: ' + esc(d.dl.name.toLowerCase()) : d.status === 'ended' ? 'этапы завершены' : 'скоро откроется'}</span></div>
    <button class="btn ghost small wide" data-open="${it.id}">Подробнее</button>
  </article>`;
}

function renderGrid() {
  const list = filtered();
  $('#grid').innerHTML = list.map(cardHTML).join('');
  $('#empty').hidden = list.length > 0;
  $('#count').textContent = `${list.length} из ${ITEMS.length} олимпиад`;
  renderActive();
}

function upcoming() {
  const now = today(), out = [];
  ITEMS.forEach(it => it.stages.forEach(s => {
    const end = pd(s.end);
    if (end >= now) out.push({ it, s, end, days: daysTo(end) });
  }));
  return out.sort((a, b) => a.end - b.end);
}

function renderTimeline() {
  const list = upcoming().slice(0, 8);
  $('#timeline').innerHTML = list.map((x, i) => {
    const u = urg(x.days);
    return `<li style="--c:${urgColor(u)};animation-delay:${i * 60}ms">
      <button data-open="${x.it.id}">
        <span class="t-date">${fmt(x.end)}<small>${x.end.getFullYear()}</small></span>
        <span class="t-name">${esc(x.it.name)}<small>${esc(x.s.name)} · ${esc(x.it.organizer)}</small></span>
        <span class="t-days">${daysLabel(x.days)}</span>
      </button></li>`;
  }).join('') || '<li style="--c:var(--muted)">Все этапы текущего сезона завершены.</li>';
  const tick = upcoming().slice(0, 6).map(x => `<span><i></i>${esc(x.it.name)} · ${esc(x.s.name.toLowerCase())} · ${daysLabel(x.days)}</span>`).join('');
  $('#ticker').innerHTML = tick + tick;
}

function renderStats() {
  $('#statCatalog').textContent = ITEMS.length;
  $('#statFav').textContent = favs.size;
  $('#favCount').textContent = favs.size;
  const nd = ITEMS.map(i => DER.get(i.id).nextDays).filter(d => d != null);
  $('#statNext').textContent = nd.length ? Math.min(...nd) : '—';
}

function countUp(el, to) {
  if (reduced) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / 900);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSubjects() {
  const all = [...new Set(ITEMS.flatMap(i => i.subjects))].sort((a, b) => a.localeCompare(b, 'ru'));
  $('#subjectChips').innerHTML = all.map(s => `<button class="chip" data-subj="${esc(s)}">${esc(s)}</button>`).join('');
}

function renderActive() {
  const chips = [];
  if (state.q) chips.push(['q', `«${state.q}»`]);
  state.subjects.forEach(s => chips.push(['subj:' + s, s]));
  state.levels.forEach(l => chips.push(['lvl:' + l, 'уровень ' + ROMAN[l]]));
  if (state.grade) chips.push(['grade', state.grade + ' класс']);
  if (state.status !== 'all') chips.push(['status', { open: 'идёт сейчас', soon: 'скоро', ended: 'завершена' }[state.status]]);
  if (state.favOnly) chips.push(['fav', 'избранное']);
  if (state.hideEnded) chips.push(['ended', 'без завершённых']);
  $('#activeChips').innerHTML = chips.map(([k, t]) => `<button class="chip" data-clear="${esc(k)}">${esc(t)} ✕</button>`).join('');
}

function renderViews() {
  $('#views').innerHTML = views.map(v => `<button class="view" data-view="${v.id}">${esc(v.name)}<b data-delview="${v.id}" aria-label="Удалить вид">✕</b></button>`).join('');
}

function syncUI() {
  $('#q').value = state.q;
  $('#grade').value = String(state.grade);
  $('#status').value = state.status;
  $('#sort').value = state.sort;
  $('#favOnly').checked = state.favOnly;
  $('#hideEnded').checked = state.hideEnded;
  $$('#subjectChips .chip').forEach(c => c.classList.toggle('on', state.subjects.has(c.dataset.subj)));
  $$('#levelSeg button').forEach(b => {
    const l = +b.dataset.level;
    b.classList.toggle('on', l === 0 ? state.levels.size === 0 : state.levels.has(l));
  });
}

function renderAll() { renderGrid(); renderTimeline(); renderStats(); }

/* ---------- drawer ---------- */
function stageState(s) {
  const now = today();
  if (pd(s.end) < now) return ['прошёл', 'var(--muted)'];
  if (pd(s.start) <= now) return ['идёт сейчас', 'var(--green)'];
  return ['скоро', 'var(--blue)'];
}
function drawerHTML(it) {
  const d = DER.get(it.id);
  return `<div class="d-head">
      <span class="lv lv${it.level}" style="justify-self:start">Уровень ${ROMAN[it.level]}</span>
      <h2 id="dTitle">${esc(it.name)}</h2><p class="d-org">${esc(it.organizer)}</p>
    </div>
    <div class="d-actions">
      <button class="btn ${favs.has(it.id) ? 'primary' : 'ghost'} small" data-fav="${it.id}">${favs.has(it.id) ? '★ В избранном' : '☆ В избранное'}</button>
      <button class="btn ghost small" data-ics="${it.id}">Скачать .ics</button>
      <button class="btn ghost small" data-copy="${it.id}">Скопировать ссылку</button>
    </div>
    <div class="d-sec"><h4>Льготы при поступлении</h4>
      <p class="d-ben">${it.bvi ? 'БВИ — поступление без вступительных испытаний в вузы, засчитывающие диплом, либо 100 баллов за профильный ЕГЭ.' : '100 баллов за профильный ЕГЭ или дополнительные баллы к портфолио — по правилам вуза.'}</p></div>
    <div class="d-sec"><h4>Предметы и классы</h4>
      <div class="subj">${it.subjects.map(s => `<span>${esc(s)}</span>`).join('')}</div>
      <p class="d-org" style="margin-top:8px">Классы: ${it.grades.join(', ')}</p></div>
    <div class="d-sec"><h4>Этапы сезона ${esc(META.perechen || '')}</h4>
      ${d.st.map(s => { const [t, c] = stageState(s); return `<div class="stage" style="--sc:${c}"><em>${t}</em><b>${esc(s.name)}</b><span>${fmtY(pd(s.start))} — ${fmtY(pd(s.end))}</span></div>`; }).join('')}</div>
    <div class="d-sec"><h4>Официальный сайт</h4><a class="d-link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url.replace('https://', ''))} ↗</a></div>`;
}
function openDrawer(id) {
  const it = ITEMS.find(i => i.id === id);
  if (!it) return;
  current = id;
  $('#dBody').innerHTML = drawerHTML(it);
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
  document.body.classList.add('locked');
  $('#dClose').focus();
  try { history.replaceState(null, '', '?o=' + id); } catch (e) {}
}
function closeDrawer() {
  current = null;
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
  document.body.classList.remove('locked');
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

/* ---------- favorites / views / toasts ---------- */
function toast(msg, undo) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button>Отменить</button>' : '');
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  if (undo) el.querySelector('button').onclick = () => { undo(); kill(); };
  $('#toasts').append(el);
  setTimeout(kill, 4500);
}
function toggleFav(id) {
  const it = ITEMS.find(i => i.id === id);
  const sync = () => { store('olimplist.favs', [...favs]); renderAll(); if (current === id) $('#dBody').innerHTML = drawerHTML(it); };
  if (favs.has(id)) {
    favs.delete(id);
    toast(`«${it.name}» убрана из избранного`, () => { favs.add(id); sync(); });
  } else {
    favs.add(id);
    toast(`«${it.name}» добавлена в избранное`, () => { favs.delete(id); sync(); });
  }
  sync();
}
function viewName() {
  const p = [];
  if (state.subjects.size) p.push([...state.subjects][0]);
  if (state.levels.size) p.push('ур. ' + [...state.levels].map(l => ROMAN[l]).join('/'));
  if (state.grade) p.push(state.grade + ' кл.');
  if (state.favOnly) p.push('избранное');
  return p.join(' · ') || 'Вид ' + (views.length + 1);
}
function saveView() {
  const v = { id: Date.now(), name: viewName(), s: { q: state.q, subjects: [...state.subjects], levels: [...state.levels], grade: state.grade, status: state.status, sort: state.sort, favOnly: state.favOnly, hideEnded: state.hideEnded } };
  views.push(v); store('olimplist.views', views); renderViews();
  toast(`Вид «${v.name}» сохранён`, () => { views = views.filter(x => x.id !== v.id); store('olimplist.views', views); renderViews(); });
}
function applyView(id) {
  const v = views.find(x => x.id === id); if (!v) return;
  Object.assign(state, { ...v.s, subjects: new Set(v.s.subjects), levels: new Set(v.s.levels) });
  syncUI(); renderAll();
}
function resetFilters() {
  Object.assign(state, { q: '', subjects: new Set(), levels: new Set(), grade: 0, status: 'all', sort: 'deadline', favOnly: false, hideEnded: false });
  syncUI(); renderAll();
}

/* ---------- ICS export ---------- */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportICS(list) {
  if (!list.length) { toast('Нечего экспортировать: список пуст'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ev = list.flatMap(it => it.stages.map(s => {
    const end = new Date(pd(s.end).getTime() + DAY);
    return ['BEGIN:VEVENT', `UID:${it.id}-${s.start}@olimplist`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${s.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${iso(end)}`,
      `SUMMARY:${it.name} — ${s.name}`, `DESCRIPTION:${it.organizer} · ${it.url}`, 'END:VEVENT'].join('\r\n');
  }));
  download('olimplist-deadlines.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Olimplist//RU', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
  toast(`Календарь скачан: ${list.length} олимпиад (.ics)`);
}

/* ---------- status / meta ---------- */
function renderMeta() {
  const upd = new Date(META.updatedAt);
  const label = upd.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('#updatedAt').textContent = label;
  $('#footUpdated').textContent = label;
  $('#srcName').textContent = (META.source || '—') +
    (typeof META.verified === 'number' ? ` · проверено ${META.verified}/${ITEMS.length}` : '');
  const pct = Math.min(100, Math.round(ITEMS.length / (META.total || ITEMS.length) * 100));
  $('#covBar').style.width = pct + '%';
  $('#covText').textContent = `${ITEMS.length} из ${META.total || ITEMS.length}`;
  $('#statTotal').textContent = META.total || ITEMS.length;
  tickUpdate();
}
function tickUpdate() {
  const due = new Date(META.updatedAt).getTime() + (META.cycleHours || 12) * 3600000;
  const diff = due - Date.now();
  $('#nextUpdate').textContent = diff <= 0 ? 'ожидается запуск' : `${Math.floor(diff / 3600000)} ч ${Math.floor(diff % 3600000 / 60000)} мин`;
}

/* ---------- wiring ---------- */
function wire() {
  let qt;
  $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 120); });
  $('#grade').addEventListener('change', e => { state.grade = +e.target.value; renderGrid(); });
  $('#status').addEventListener('change', e => { state.status = e.target.value; renderGrid(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
  $('#favOnly').addEventListener('change', e => { state.favOnly = e.target.checked; renderGrid(); });
  $('#hideEnded').addEventListener('change', e => { state.hideEnded = e.target.checked; renderGrid(); });
  $('#subjectChips').addEventListener('click', e => {
    const c = e.target.closest('[data-subj]'); if (!c) return;
    const s = c.dataset.subj;
    state.subjects.has(s) ? state.subjects.delete(s) : state.subjects.add(s);
    syncUI(); renderGrid();
  });
  $('#levelSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-level]'); if (!b) return;
    const l = +b.dataset.level;
    if (l === 0) state.levels.clear(); else state.levels.has(l) ? state.levels.delete(l) : state.levels.add(l);
    syncUI(); renderGrid();
  });
  $('#activeChips').addEventListener('click', e => {
    const c = e.target.closest('[data-clear]'); if (!c) return;
    const [k, v] = c.dataset.clear.split(':');
    if (k === 'q') state.q = '';
    if (k === 'subj') state.subjects.delete(v);
    if (k === 'lvl') state.levels.delete(+v);
    if (k === 'grade') state.grade = 0;
    if (k === 'status') state.status = 'all';
    if (k === 'fav') state.favOnly = false;
    if (k === 'ended') state.hideEnded = false;
    syncUI(); renderGrid();
  });
  $('#resetFilters').addEventListener('click', resetFilters);
  $('#emptyReset').addEventListener('click', resetFilters);
  $('#saveView').addEventListener('click', saveView);
  $('#views').addEventListener('click', e => {
    const del = e.target.closest('[data-delview]');
    if (del) {
      const id = +del.dataset.delview, v = views.find(x => x.id === id);
      views = views.filter(x => x.id !== id); store('olimplist.views', views); renderViews();
      toast(`Вид «${v.name}» удалён`, () => { views.push(v); store('olimplist.views', views); renderViews(); });
      return;
    }
    const ap = e.target.closest('[data-view]'); if (ap) applyView(+ap.dataset.view);
  });
  $('#grid').addEventListener('click', e => {
    const f = e.target.closest('[data-fav]'); if (f) { toggleFav(f.dataset.fav); return; }
    const o = e.target.closest('[data-open]'); if (o) openDrawer(o.dataset.open);
  });
  $('#timeline').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) openDrawer(o.dataset.open);
  });
  $('#dBody').addEventListener('click', e => {
    const f = e.target.closest('[data-fav]'); if (f) { toggleFav(f.dataset.fav); return; }
    const ic = e.target.closest('[data-ics]'); if (ic) { exportICS(ITEMS.filter(i => i.id === ic.dataset.ics)); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const url = location.href.split(/[?#]/)[0] + '?o=' + cp.dataset.copy;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(() => toast('Ссылка на олимпиаду скопирована'))
        .catch(() => toast('Не удалось скопировать ссылку'));
    }
  });
  $('#dClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) closeDrawer(); });
  $('#icsAll').addEventListener('click', () => exportICS(filtered()));
  $('#favBtn').addEventListener('click', () => {
    state.favOnly = !state.favOnly; syncUI(); renderGrid();
    $('#catalog').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
  $('#themeBtn').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t; store('olimplist.theme', t);
  });
}

function observe() {
  const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .15 });
  $$('.reveal').forEach(el => io.observe(el));
  const so = new IntersectionObserver(es => es.forEach(x => {
    if (!x.isIntersecting) return;
    $$('#navLinks a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + x.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['deadline', 'catalog', 'how', 'about'].forEach(id => so.observe($('#' + id)));
  const st = new IntersectionObserver(es => es.forEach(x => {
    if (!x.isIntersecting) return;
    countUp($('#statTotal'), META.total || ITEMS.length);
    countUp($('#statCatalog'), ITEMS.length);
    st.unobserve(x.target);
  }), { threshold: .4 });
  st.observe($('#stats'));
  if (!reduced) {
    let raf = 0;
    addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { $('.bg').style.transform = `translate3d(0,${scrollY * .1}px,0)`; raf = 0; });
    }, { passive: true });
  }
}

async function loadData() {
  for (const path of ['data/olimpiads.json', 'data/olympiads.json']) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  return JSON.parse($('#olimp-seed').textContent);
}

async function init() {
  const data = await loadData();
  META = data.meta || {};
  ITEMS = data.items || [];
  ITEMS.forEach(it => DER.set(it.id, derive(it)));
  renderSubjects(); syncUI(); renderAll(); renderViews(); renderMeta(); wire(); observe();
  setInterval(tickUpdate, 30000);
  const oid = new URLSearchParams(location.search).get('o');
  if (oid && DER.has(oid)) openDrawer(oid);
}
init();
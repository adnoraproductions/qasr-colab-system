// Day-to-day views: dashboard and schedule.
import {
  state, can, api, html, icon, inr, compact, fmtDate, relDay, today, addDays, dow, parse, groupBy, on, toast, oops,
  emptyState, monthRange, productLabel, fmtTime,
} from './lib.js';
import { collabCard, bindCollabCards, openCollabForm, openCollab } from './collab.js';

const go = (hash) => { location.hash = hash; };

// ───────────── shared: date strip ─────────────
function dateStrip(selected, counts, from, days = 28) {
  const t = today();
  return html`<div class="datestrip" data-strip>${Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i); const n = counts[d] || 0;
    return html`<button class="day ${d === selected ? 'on' : ''} ${d === t ? 'today' : ''}" data-day="${d}">
      <span class="dw">${d === t ? 'Today' : dow(d)}</span><span class="dn">${parse(d).getDate()}</span>
      <span class="dots">${Array.from({ length: Math.min(n, 3) }, () => html`<i></i>`)}</span></button>`;
  })}</div>`;
}
function centerStrip(main) {
  const s = main.querySelector('[data-strip]'); const on = s?.querySelector('.day.on');
  if (s && on) s.scrollLeft = on.offsetLeft - s.clientWidth / 2 + on.clientWidth / 2;
}
const countBy = (rows) => rows.reduce((m, c) => { if (c.status !== 'cancelled') m[c.date] = (m[c.date] || 0) + 1; return m; }, {});
const listByDate = (rows, opts) => Object.entries(groupBy(rows, (c) => c.date)).map(([d, cs]) => html`
  <div class="date-h"><b>${relDay(d)}</b><span>${d === today() || d === addDays(today(), 1) || d === addDays(today(), -1) ? fmtDate(d) + ' · ' : ''}${cs.length} collab${cs.length > 1 ? 's' : ''}</span></div>
  <div class="grid-cards">${cs.map((c) => collabCard(c, opts))}</div>`);

// ───────────── dashboard ─────────────
export async function dashboardView(main) {
  const d = await api(`/dashboard?today=${today()}`);
  const t = today();
  const todays = d.upcoming.filter((c) => c.date === t);
  const next = d.upcoming.filter((c) => c.date > t && c.date <= addDays(t, 7));
  const m = d.month.totals;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const [ms] = monthRange(0);

  main.innerHTML = String(html`
    <div class="hero">
      <div class="greet">${greet}, ${state.user.name.split(' ')[0]}</div>
      <div class="big">${todays.length ? `${todays.length} collab${todays.length > 1 ? 's' : ''} today` : 'No collabs today'}</div>
      <div class="hstats">
        <div class="hstat"><b>${next.length}</b><span>Next 7 days</span></div>
        <div class="hstat"><b>${m.active}</b><span>This month</span></div>
        <div class="hstat"><b>${d.month.statusCounts.posted}</b><span>Posted</span></div>
      </div>
    </div>

    ${d.needsItems || d.pendingPosts || (can('collab.items') && (todays.length || next.some((c) => c.date === addDays(t, 1)))) ? html`<div class="section"><div class="attn">
      ${can('collab.items') && todays.some((c) => c.items.length) ? html`<a href="#/lists?date=${t}"><span class="n brand">${icon('send', 'xs')}</span><span class="grow">Share today's outlet & kitchen lists</span>${icon('right', 'sm')}</a>` : ''}
      ${can('collab.items') && next.some((c) => c.date === addDays(t, 1) && c.items.length) ? html`<a href="#/lists?date=${addDays(t, 1)}"><span class="n brand">${icon('send', 'xs')}</span><span class="grow">Share tomorrow's lists</span>${icon('right', 'sm')}</a>` : ''}
      ${d.needsItems ? html`<a href="#/schedule?view=upcoming&noitems=1"><span class="n">${d.needsItems}</span><span class="grow">Upcoming collab${d.needsItems > 1 ? 's need' : ' needs'} products</span>${icon('right', 'sm')}</a>` : ''}
      ${d.pendingPosts ? html`<a href="#/schedule?view=list&status=completed"><span class="n brand">${d.pendingPosts}</span><span class="grow">Waiting for the content link</span>${icon('right', 'sm')}</a>` : ''}
    </div></div>` : ''}

    <div class="section">
      <div class="section-h"><h2>Today</h2><a href="#/schedule">Full schedule</a></div>
      ${todays.length ? html`<div class="grid-cards">${todays.map((c) => collabCard(c))}</div>`
        : html`<div class="card">${emptyState('calendar', 'Nothing scheduled today', 'Enjoy the calm, or plan the next one.', can('collab.create') ? html`<button class="btn ghost" data-new>${icon('plus', 'sm')}Schedule a collab</button>` : '')}</div>`}
    </div>

    ${next.length ? html`<div class="section"><div class="section-h"><h2>Coming up</h2><a href="#/schedule?view=upcoming">See all</a></div>${listByDate(next, { showDate: false })}</div>` : ''}

    ${can('report.view') ? html`<div class="section">
      <div class="section-h"><h2>This month</h2><a href="#/reports?from=${ms}">Full report</a></div>
      <div class="stats">
        <div class="stat accent"><div class="k">Total investment</div><div class="v">${inr(m.investment)}</div><div class="s">Products + paid</div></div>
        <div class="stat"><div class="k">Product value</div><div class="v">${inr(m.product_value)}</div><div class="s">${m.items} items given</div></div>
        <div class="stat"><div class="k">Paid to influencers</div><div class="v">${inr(m.paid_amount)}</div><div class="s">${m.paid} paid · ${m.barter} barter</div></div>
        <div class="stat"><div class="k">Est. reach</div><div class="v">${compact(m.reach)}</div><div class="s">${m.influencers} influencers</div></div>
      </div>
      ${d.month.topOutlets.length ? html`<div class="card" style="margin-top:12px"><div class="bold" style="margin-bottom:12px">Top outlets</div><div class="bars">
        ${d.month.topOutlets.map((o) => html`<div class="bar-row"><span class="lbl">${o.name}</span><span class="track"><span class="fill" style="width:${(o.count / d.month.topOutlets[0].count) * 100}%"></span></span><span class="val">${o.count}</span></div>`)}</div></div>` : ''}
    </div>` : ''}
  `);
  bindCollabCards(main);
  on(main, 'click', '[data-new]', () => openCollabForm({}));
}

// ───────────── schedule ─────────────
export async function scheduleView(main, params) {
  const view = params.view || 'day';
  const sel = params.date || today();
  const filters = { outlet: params.outlet || '', type: params.type || '', status: params.status || '', q: params.q || '' };
  const qs = (o) => '?' + new URLSearchParams(Object.entries({ view, date: sel, ...filters, ...o }).filter(([, v]) => v)).toString();
  const fq = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  let rows, counts = {}, stripFrom = addDays(sel, -7);
  if (view === 'day') {
    const all = await api(`/collabs?from=${stripFrom}&to=${addDays(stripFrom, 27)}&${fq}`);
    counts = countBy(all); rows = all.filter((c) => c.date === sel);
  } else if (view === 'upcoming') {
    rows = await api(`/collabs?from=${today()}&${fq}${filters.status ? '' : '&status=active'}`);
    if (params.noitems) rows = rows.filter((c) => !c.items.length);
  } else {
    rows = await api(`/collabs?order=desc&${fq}`);
  }
  const isOutlet = state.user.role === 'outlet';
  const opts = { showOutlet: !isOutlet && !filters.outlet, showDate: false };
  const activeFilters = [filters.outlet, filters.type, filters.status, filters.q].filter(Boolean).length;

  main.innerHTML = String(html`
    <div class="row" style="margin-bottom:12px">
      <div class="seg grow" data-view>${[['day', 'Day'], ['upcoming', 'Upcoming'], ['list', 'All']].map(([v, l]) => html`<button class="${view === v ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div>
      <button class="icon-btn" data-filters aria-label="Filters" style="position:relative">${icon('filter', 'sm')}${activeFilters ? html`<span class="badge" style="position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:var(--brand);color:#fff;font-size:10px;font-weight:800;display:grid;place-items:center">${activeFilters}</span>` : ''}</button>
      <label class="icon-btn" aria-label="Jump to date" style="position:relative;overflow:hidden">${icon('calendar', 'sm')}<input type="date" data-jump value="${sel}" style="position:absolute;inset:0;opacity:0" /></label>
    </div>

    <div class="card ${activeFilters || params.showf ? '' : 'hidden'}" data-fpanel style="margin-bottom:12px">
      <div class="search">${icon('search', 'sm')}<input class="input" data-f="q" placeholder="Search influencer, outlet, notes" value="${filters.q}" /></div>
      <div class="grid2" style="margin-top:10px">
        ${isOutlet ? '' : html`<select class="input" data-f="outlet"><option value="">All outlets</option>${state.outlets.map((o) => html`<option value="${o.id}" ${o.id == filters.outlet ? 'selected' : ''}>${o.name}</option>`)}</select>`}
        <select class="input" data-f="type"><option value="">Barter & paid</option><option value="barter" ${filters.type === 'barter' ? 'selected' : ''}>Barter only</option><option value="paid" ${filters.type === 'paid' ? 'selected' : ''}>Paid only</option></select>
        <select class="input" data-f="status"><option value="">Any status</option>${[['scheduled', 'Scheduled'], ['confirmed', 'Confirmed'], ['completed', 'Visited'], ['posted', 'Posted'], ['cancelled', 'Cancelled'], ['no_show', 'No show']].map(([v, l]) => html`<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`)}</select>
      </div>
      ${activeFilters ? html`<button class="btn light sm" style="margin-top:10px" data-clearf>${icon('x', 'sm')}Clear filters</button>` : ''}
    </div>

    ${view === 'day' ? html`
      ${dateStrip(sel, counts, stripFrom)}
      <div class="section-h" style="margin-top:12px"><h2>${relDay(sel)}${sel === today() || Math.abs(parse(sel) - parse(today())) < 2 * 864e5 ? html` <span class="muted small" style="font-weight:600">${fmtDate(sel)}</span>` : ''}</h2>
        <span class="muted small bold">${rows.length} collab${rows.length === 1 ? '' : 's'}</span></div>
      ${rows.length ? html`<div class="grid-cards">${rows.map((c) => collabCard(c, opts))}</div>`
        : html`<div class="card">${emptyState('calendar', 'No collabs on this day', isOutlet ? 'Nothing planned for your outlet on this date.' : 'Pick another date or schedule one.', can('collab.create') ? html`<button class="btn ghost" data-new>${icon('plus', 'sm')}Schedule for ${fmtDate(sel)}</button>` : '')}</div>`}`
    : rows.length ? listByDate(rows, opts) : html`<div class="card">${emptyState('calendar', 'Nothing here', activeFilters ? 'No collabs match these filters.' : 'No collabs to show yet.')}</div>`}
  `);

  requestAnimationFrame(() => centerStrip(main));
  bindCollabCards(main);
  on(main, 'click', '[data-view] button', (e, b) => go('#/schedule' + qs({ view: b.dataset.v, noitems: '' })));
  on(main, 'click', '[data-day]', (e, b) => go('#/schedule' + qs({ date: b.dataset.day })));
  on(main, 'change', '[data-jump]', (e, t) => t.value && go('#/schedule' + qs({ date: t.value, view: 'day' })));
  on(main, 'click', '[data-filters]', () => main.querySelector('[data-fpanel]').classList.toggle('hidden'));
  on(main, 'change', 'select[data-f]', (e, t) => go('#/schedule' + qs({ [t.dataset.f]: t.value, showf: 1 })));
  let timer; on(main, 'input', 'input[data-f]', (e, t) => { clearTimeout(timer); timer = setTimeout(() => go('#/schedule' + qs({ q: t.value, showf: 1 })), 450); });
  on(main, 'click', '[data-clearf]', () => go(`#/schedule?view=${view}&date=${sel}`));
  on(main, 'click', '[data-new]', () => openCollabForm({ date: sel }));
}

export { productLabel };

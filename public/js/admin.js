// Management views: reports, outlets, menu, team, profile.
import {
  state, can, api, html, icon, inr, compact, initials, fmtDate, shortDate, today, addDays, monthRange, groupBy, on, toast, oops,
  emptyState, openSheet, confirmSheet, formData, copyText, waLink, loadLookups, STATUS, ROLE, statusPill, fmtStamp, relDay,
} from './lib.js';
import { openCollab } from './collab.js';

const go = (hash) => { location.hash = hash; };
const changed = () => window.dispatchEvent(new Event('ql:changed'));

// ───────────── reports ─────────────
const STATUS_COLORS = { scheduled: '#000ade', confirmed: '#0a7fc2', completed: '#6b3fd6', posted: '#0f9d6b', cancelled: '#d93848', no_show: '#c27a00' };

function presets() {
  const t = today(); const y = t.slice(0, 4);
  return [
    ['month', 'This month', ...monthRange(0)],
    ['last', 'Last month', ...monthRange(-1)],
    ['7', 'Last 7 days', addDays(t, -6), t],
    ['30', 'Last 30 days', addDays(t, -29), t],
    ['year', 'This year', `${y}-01-01`, `${y}-12-31`],
  ];
}

export async function reportsView(main, params) {
  const P = presets();
  const preset = params.preset || (params.from ? 'custom' : 'month');
  const p = P.find((x) => x[0] === preset);
  const from = p ? p[2] : params.from || monthRange(0)[0];
  const to = p ? p[3] : params.to || today();
  const outlet = params.outlet || ''; const type = params.type || '';
  const q = new URLSearchParams(Object.entries({ from, to, outlet, type }).filter(([, v]) => v)).toString();
  const r = await api(`/reports?${q}`);
  const T = r.totals;
  const nav = (o) => go('#/reports?' + new URLSearchParams(Object.entries({ preset, from: preset === 'custom' ? from : '', to: preset === 'custom' ? to : '', outlet, type, ...o }).filter(([, v]) => v)).toString());
  const outletName = state.outlets.find((o) => o.id == outlet)?.name;

  // collabs per day across the whole range (cap at 62 bars)
  const dayMap = Object.fromEntries(r.byDay.map((d) => [d.date, d.count]));
  const span = Math.min(62, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
  const series = Array.from({ length: Math.max(1, span) }, (_, i) => { const d = addDays(from, i); return [d, dayMap[d] || 0]; });
  const maxDay = Math.max(1, ...series.map((s) => s[1]));
  const statusTotal = Object.values(r.statusCounts).reduce((a, b) => a + b, 0) || 1;
  const unused = state.outlets.filter((o) => o.active && !r.byOutlet.some((b) => b.id === o.id) && (!outlet || o.id == outlet));
  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);

  main.innerHTML = String(html`
    <div class="print-only print-head"><img src="/assets/logo-blue.png" alt="Qasr Laban" /><div style="text-align:right"><b style="font-size:16px">Collaboration Report</b><div class="muted">${fmtDate(from, true)} – ${fmtDate(to, true)}${outletName ? ' · ' + outletName : ''}${type ? ' · ' + type : ''}</div></div></div>

    <div class="no-print">
      <div class="chips">${P.map(([k, l]) => html`<button class="chip ${preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`)}<button class="chip ${preset === 'custom' ? 'on' : ''}" data-preset="custom">Custom</button></div>
      <div class="card" style="margin-top:12px">
        <div class="grid2 ${preset === 'custom' ? '' : 'hidden'}" style="margin-bottom:10px">
          <label class="field"><span>From</span><input class="input" type="date" data-r="from" value="${from}" /></label>
          <label class="field"><span>To</span><input class="input" type="date" data-r="to" value="${to}" /></label>
        </div>
        <div class="grid2">
          <select class="input" data-r="outlet"><option value="">All outlets</option>${state.outlets.map((o) => html`<option value="${o.id}" ${o.id == outlet ? 'selected' : ''}>${o.name}</option>`)}</select>
          <select class="input" data-r="type"><option value="">Barter & paid</option><option value="barter" ${type === 'barter' ? 'selected' : ''}>Barter only</option><option value="paid" ${type === 'paid' ? 'selected' : ''}>Paid only</option></select>
        </div>
        <div class="row" style="margin-top:12px">
          <a class="btn ghost sm grow" href="/api/reports/export.csv?${q}">${icon('download', 'sm')}Excel / CSV</a>
          <button class="btn ghost sm grow" data-print>${icon('print', 'sm')}Print / PDF</button>
        </div>
        <div class="muted tiny" style="margin-top:8px;text-align:center">${fmtDate(from, true)} – ${fmtDate(to, true)}</div>
      </div>
    </div>

    <div class="section">
      <div class="stats">
        <div class="stat accent"><div class="k">Total investment</div><div class="v">${inr(T.investment)}</div><div class="s">${inr(T.cost_per_collab)} per collab</div></div>
        <div class="stat"><div class="k">Collabs</div><div class="v">${T.active}</div><div class="s">${T.barter} barter · ${T.paid} paid${T.collabs - T.active ? ` · ${T.collabs - T.active} dropped` : ''}</div></div>
        <div class="stat"><div class="k">Product value</div><div class="v">${inr(T.product_value)}</div><div class="s">${T.items} items</div></div>
        <div class="stat"><div class="k">Paid to influencers</div><div class="v">${inr(T.paid_amount)}</div><div class="s">${inr(T.paid_settled)} settled · ${inr(T.paid_amount - T.paid_settled)} due</div></div>
      </div>
      <div class="panel" style="margin-top:10px">
        <div class="prow"><span>Influencers</span><b>${T.influencers} · ${compact(T.reach)} reach</b></div>
        <div class="prow"><span>Content posted</span><b>${T.posted} of ${T.active} (${T.active ? Math.round((T.posted / T.active) * 100) : 0}%)</b></div>
        <div class="prow"><span>Outlets covered</span><b>${T.outlets} of ${state.outlets.filter((o) => o.active).length}</b></div>
      </div>
    </div>

    ${T.collabs ? html`
    <div class="section"><div class="card">
      <div class="row between"><div class="bold">Collabs per day</div><span class="muted small bold">peak ${maxDay}</span></div>
      <div class="vbars">${series.map(([d, n]) => html`<div class="vb ${n ? '' : 'zero'}" title="${fmtDate(d)}: ${n}"><i style="height:${(n / maxDay) * 100}%"></i></div>`)}</div>
      <div class="vbars-x"><span>${shortDate(series[0][0])}</span><span>${shortDate(series[series.length - 1][0])}</span></div>
    </div></div>

    <div class="section"><div class="card">
      <div class="bold" style="margin-bottom:12px">Status</div>
      <div class="stackbar">${Object.entries(r.statusCounts).filter(([, n]) => n).map(([s, n]) => html`<i style="width:${(n / statusTotal) * 100}%;background:${STATUS_COLORS[s]}"></i>`)}</div>
      <div class="legend">${Object.entries(r.statusCounts).map(([s, n]) => html`<span><i style="background:${STATUS_COLORS[s]}"></i>${STATUS[s].label} <b>${n}</b></span>`)}</div>
    </div></div>

    <div class="section"><div class="section-h"><h2>By outlet</h2></div><div class="card"><div class="table-wrap"><table class="t">
      <thead><tr><th>Outlet</th><th class="r">Collabs</th><th class="r">Barter</th><th class="r">Paid</th><th class="r">Products</th><th class="r">Paid ₹</th><th class="r">Total</th></tr></thead>
      <tbody>${r.byOutlet.map((o) => html`<tr><td><b>${o.name}</b><div class="muted tiny">${o.district}</div></td><td class="r">${o.count}</td><td class="r">${o.barter}</td><td class="r">${o.paid}</td><td class="r">${inr(o.product_value)}</td><td class="r">${inr(o.paid_amount)}</td><td class="r"><b>${inr(o.total)}</b></td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${sum(r.byOutlet, 'count')}</td><td class="r">${sum(r.byOutlet, 'barter')}</td><td class="r">${sum(r.byOutlet, 'paid')}</td><td class="r">${inr(sum(r.byOutlet, 'product_value'))}</td><td class="r">${inr(sum(r.byOutlet, 'paid_amount'))}</td><td class="r">${inr(sum(r.byOutlet, 'total'))}</td></tr></tfoot>
    </table></div>
    ${unused.length ? html`<p class="note"><b>No collabs yet:</b> ${unused.map((o) => o.name).join(', ')}</p>` : ''}
    </div></div>

    <div class="section"><div class="section-h"><h2>By influencer</h2></div><div class="card"><div class="table-wrap"><table class="t">
      <thead><tr><th>Influencer</th><th class="r">Followers</th><th class="r">Collabs</th><th class="r">Posted</th><th class="r">Products</th><th class="r">Paid ₹</th><th class="r">Total</th></tr></thead>
      <tbody>${r.byInfluencer.map((i) => html`<tr><td><b>${i.name}</b>${i.handle ? html`<div class="muted tiny">${i.url ? html`<a href="${i.url}" target="_blank" rel="noopener">@${i.handle}</a>` : '@' + i.handle}</div>` : ''}</td><td class="r">${compact(i.followers)}</td><td class="r">${i.count}</td><td class="r">${i.posted}</td><td class="r">${inr(i.product_value)}</td><td class="r">${inr(i.paid_amount)}</td><td class="r"><b>${inr(i.total)}</b></td></tr>`)}</tbody>
    </table></div></div></div>

    ${r.byProduct.length ? html`<div class="section"><div class="section-h"><h2>Products given</h2></div><div class="card"><div class="table-wrap"><table class="t">
      <thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Value</th></tr></thead>
      <tbody>${r.byProduct.map((p) => html`<tr><td>${p.label}</td><td class="r">${p.qty}</td><td class="r">${inr(p.value)}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${sum(r.byProduct, 'qty')}</td><td class="r">${inr(sum(r.byProduct, 'value'))}</td></tr></tfoot>
    </table></div></div></div>` : ''}

    <div class="section"><div class="section-h"><h2>All collabs <span class="muted small">(${r.rows.length})</span></h2></div><div class="card"><div class="table-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Outlet</th><th>Influencer</th><th>Type</th><th>Status</th><th>Products</th><th class="r">Cost</th></tr></thead>
      <tbody>${r.rows.map((c) => html`<tr data-row="${c.id}" style="cursor:pointer"><td style="white-space:nowrap">${shortDate(c.date)}</td><td>${c.outlet_name}</td><td><b>${c.inf_name}</b>${c.post_link ? html` <a href="${c.post_link}" target="_blank" rel="noopener" title="Content">${icon('ext', 'xs')}</a>` : ''}</td>
        <td>${c.type === 'paid' ? 'Paid' : 'Barter'}</td><td>${statusPill(c.status)}</td><td class="small">${c.items.map((i) => `${i.label} ×${i.qty}`).join(', ') || '—'}</td><td class="r">${inr(c.product_value + (c.amount || 0))}</td></tr>`)}</tbody>
    </table></div></div></div>
    ` : html`<div class="section"><div class="card">${emptyState('chart', 'No collabs in this period', 'Try a different date range or filter.')}</div></div>`}
    <div class="print-only muted tiny" style="margin-top:16px">Generated ${new Date().toLocaleString('en-IN')} · Qasr Laban Collab Manager</div>
  `);

  on(main, 'click', '[data-preset]', (e, b) => nav({ preset: b.dataset.preset, from: b.dataset.preset === 'custom' ? from : '', to: b.dataset.preset === 'custom' ? to : '' }));
  on(main, 'change', '[data-r]', (e, t) => nav({ [t.dataset.r]: t.value, ...(t.dataset.r === 'from' || t.dataset.r === 'to' ? { preset: 'custom', from: t.dataset.r === 'from' ? t.value : from, to: t.dataset.r === 'to' ? t.value : to } : {}) }));
  on(main, 'click', '[data-print]', () => window.print());
  on(main, 'click', '[data-row]', (e, t) => { if (!e.target.closest('a')) openCollab(Number(t.dataset.row)); });
}

// ───────────── outlets ─────────────
const shareUrl = (o) => `${location.origin}/o/${o.share_token}`;

export async function outletsView(main) {
  const list = await api('/outlets');
  const groups = groupBy(list, (o) => (o.active ? o.district || 'Other' : 'Inactive'));
  main.innerHTML = String(html`
    <div class="row between" style="margin-bottom:6px"><div class="muted small bold">${list.filter((o) => o.active).length} active outlets</div>
      <button class="btn sm" data-add>${icon('plus', 'sm')}Add outlet</button></div>
    <p class="note">Tap ${icon('send', 'xs')} to send an outlet its private schedule link on WhatsApp — no login needed.</p>
    ${Object.entries(groups).sort(([a], [b]) => (a === 'Inactive') - (b === 'Inactive') || a.localeCompare(b)).map(([g, os]) => html`
      <div class="cat-h"><span>${g}</span><span>${os.length}</span></div>
      <div class="list-card">${os.map((o) => html`<div class="li">
        <div class="avatar">${initials(o.name)}</div>
        <button class="grow" style="text-align:left" data-edit="${o.id}"><div class="t1">${o.name}</div><div class="t2">${o.upcoming} upcoming · ${o.collabs} total${o.manager_name ? ' · ' + o.manager_name : ''}</div></button>
        <button class="icon-btn" data-share="${o.id}" aria-label="Share link">${icon('send', 'sm')}</button>
      </div>`)}</div>`)}
  `);
  on(main, 'click', '[data-add]', () => outletForm(null));
  on(main, 'click', '[data-edit]', (e, b) => outletForm(list.find((o) => o.id == b.dataset.edit)));
  on(main, 'click', '[data-share]', (e, b) => outletShare(list.find((o) => o.id == b.dataset.share)));
}

function outletShare(o) {
  const link = shareUrl(o);
  const msg = `Hi ${o.name} team 👋\nHere is your Qasr Laban collab schedule. Open this link to see upcoming influencer visits and products:\n${link}`;
  const s = openSheet({
    title: `${o.name} link`,
    body: html`<p class="muted small" style="margin:0 2px 12px">Anyone with this link can view this outlet's upcoming collabs (no prices shown). Reset it if it gets shared by mistake.</p>
      <div class="card row" style="padding:12px"><span class="grow ellipsis small bold">${link}</span><button class="icon-btn" data-copy>${icon('copy', 'sm')}</button></div>
      <div class="row" style="margin-top:12px"><a class="btn green grow" href="${waLink(msg, o.phone || '')}" target="_blank" rel="noopener">${icon('wa', 'sm')}Send on WhatsApp</a><a class="btn light" href="${link}" target="_blank" rel="noopener">${icon('eye', 'sm')}Open</a></div>
      <button class="btn light block sm" style="margin-top:12px" data-reset>${icon('refresh', 'sm')}Reset link</button>`,
  });
  on(s.el, 'click', '[data-copy]', () => copyText(link, 'Link copied'));
  on(s.el, 'click', '[data-reset]', async () => {
    if (!(await confirmSheet({ title: 'Reset link?', message: 'The old link will stop working. You will need to send the new link to the outlet.', ok: 'Reset' }))) return;
    try { const n = await api(`/outlets/${o.id}/token`, { method: 'POST' }); s.close(); toast('New link created'); await loadLookups(); changed(); outletShare(n); } catch (e) { oops(e); }
  });
}

function outletForm(o) {
  const s = openSheet({
    title: o ? 'Edit outlet' : 'Add outlet',
    body: html`<form data-f>
      <label class="field"><span>Outlet name</span><input class="input" name="name" value="${o?.name}" placeholder="e.g. Kaloor" /></label>
      <label class="field"><span>District</span><input class="input" name="district" value="${o?.district}" list="districts" /></label>
      <datalist id="districts">${[...new Set(state.outlets.map((x) => x.district).filter(Boolean))].map((d) => html`<option value="${d}">`)}</datalist>
      <div class="grid2">
        <label class="field"><span>Manager</span><input class="input" name="manager_name" value="${o?.manager_name}" /></label>
        <label class="field"><span>Phone / WhatsApp</span><input class="input" name="phone" type="tel" value="${o?.phone}" /></label>
      </div>
      <label class="field"><span>Address</span><textarea class="input" name="address" style="min-height:64px">${o?.address}</textarea></label>
      <label class="field"><span>Google Maps link</span><input class="input" name="maps_url" value="${o?.maps_url}" inputmode="url" /></label>
      <label class="check" style="margin-top:16px"><input type="checkbox" name="active" ${!o || o.active ? 'checked' : ''} />Active outlet</label>
    </form>`,
    foot: html`${o ? html`<button class="btn danger" data-del style="flex:none;width:52px;padding:0">${icon('trash')}</button>` : ''}<button class="btn" data-save>${icon('check', 'sm')}Save</button>`,
  });
  on(s.el, 'click', '[data-save]', async () => {
    try { await api(o ? `/outlets/${o.id}` : '/outlets', { method: o ? 'PUT' : 'POST', body: formData(s.el.querySelector('[data-f]')) }); s.close(); toast('Outlet saved'); await loadLookups(); changed(); } catch (e) { oops(e); }
  });
  on(s.el, 'click', '[data-del]', async () => {
    if (!(await confirmSheet({ title: `Delete ${o.name}?`, message: 'The outlet will be permanently removed. Outlets with collabs cannot be deleted — untick "Active" instead.', ok: 'Delete', danger: true }))) return;
    try { await api(`/outlets/${o.id}`, { method: 'DELETE' }); s.close(); toast('Outlet deleted'); await loadLookups(); changed(); } catch (e) { oops(e); }
  });
}

// ───────────── menu / products ─────────────
export async function menuView(main) {
  await loadLookups();
  main.innerHTML = String(html`
    <div class="row" style="margin-bottom:6px"><div class="muted small bold grow">${state.products.filter((p) => p.active).length} active products</div>
      <button class="btn light sm" data-card>${icon('eye', 'sm')}Menu card</button><button class="btn sm" data-add>${icon('plus', 'sm')}Add</button></div>
    <div class="list-card" style="margin-top:10px">${state.products.map((p) => html`<button class="li" data-p="${p.id}" style="${p.active ? '' : 'opacity:.5'}"><div class="grow"><div class="t1">${p.name}</div>${p.active ? '' : html`<div class="t2">Hidden</div>`}</div><b class="num">${inr(p.price)}</b>${icon('right', 'sm')}</button>`)}</div>
  `);
  on(main, 'click', '[data-add]', () => productForm(null));
  on(main, 'click', '[data-p]', (e, b) => productForm(state.products.find((p) => p.id == b.dataset.p)));
  on(main, 'click', '[data-card]', () => openSheet({ title: 'Menu card', wide: true, body: html`<div class="menu-imgs"><img src="/assets/menu-1.jpg" alt="Menu page 1" /><img src="/assets/menu-2.jpg" alt="Menu page 2" /></div>` }));
}

function productForm(p) {
  const s = openSheet({
    title: p ? 'Edit product' : 'Add product',
    body: html`<form data-f>
      <label class="field"><span>Product name</span><input class="input" name="name" value="${p?.name}" placeholder="e.g. Salankatia" /></label>
      <label class="field"><span>Price (₹)</span><input class="input" name="price" type="number" inputmode="numeric" value="${p?.price}" /></label>
      <label class="check" style="margin-top:16px"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''} />Available for collabs</label>
    </form>`,
    foot: html`${p ? html`<button class="btn danger" data-del style="flex:none;width:52px;padding:0">${icon('trash')}</button>` : ''}<button class="btn" data-save>${icon('check', 'sm')}Save</button>`,
  });
  on(s.el, 'click', '[data-save]', async () => {
    try { await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body: formData(s.el.querySelector('[data-f]')) }); s.close(); toast('Product saved'); await loadLookups(); changed(); } catch (e) { oops(e); }
  });
  on(s.el, 'click', '[data-del]', async () => {
    if (!(await confirmSheet({ title: 'Delete product?', message: `${p.name} will be permanently removed from the menu. Past collabs keep their record. To hide it temporarily, untick "Available" instead.`, ok: 'Delete', danger: true }))) return;
    try { await api(`/products/${p.id}`, { method: 'DELETE' }); s.close(); toast('Product deleted'); await loadLookups(); changed(); } catch (e) { oops(e); }
  });
}

// ───────────── team ─────────────
export async function teamView(main) {
  const users = await api('/users');
  const groups = groupBy(users, (u) => u.role);
  main.innerHTML = String(html`
    <div class="row between" style="margin-bottom:6px"><div class="muted small bold">${users.length} logins</div><button class="btn sm" data-add>${icon('plus', 'sm')}Add login</button></div>
    ${['admin', 'social', 'outlet'].filter((r) => groups[r]).map((r) => html`
      <div class="cat-h"><span>${ROLE[r]}</span><span>${groups[r].length}</span></div>
      <div class="list-card">${groups[r].map((u) => html`<button class="li" data-u="${u.id}" style="${u.active ? '' : 'opacity:.5'}">
        <div class="avatar ${u.role === 'admin' ? 'ink' : ''}">${initials(u.name)}</div>
        <div class="grow"><div class="t1">${u.name}${u.id === state.user.id ? ' (you)' : ''}</div><div class="t2">@${u.username}${u.outlet_name ? ' · ' + u.outlet_name : ''}${u.active ? '' : ' · disabled'}</div></div>
        <div class="muted tiny" style="text-align:right">${u.last_login ? html`Last in<br>${fmtStamp(u.last_login)}` : html`Never<br>signed in`}</div></button>`)}</div>`)}
  `);
  on(main, 'click', '[data-add]', () => userForm(null));
  on(main, 'click', '[data-u]', (e, b) => userForm(users.find((u) => u.id == b.dataset.u)));
}

function userForm(u) {
  const s = openSheet({
    title: u ? 'Edit login' : 'Add login',
    body: html`<form data-f autocomplete="off">
      <label class="field"><span>Name</span><input class="input" name="name" value="${u?.name}" /></label>
      <label class="field"><span>Username</span><input class="input" name="username" value="${u?.username}" autocapitalize="none" placeholder="e.g. kaloor" /></label>
      <label class="field"><span>Role</span><select class="input" name="role" data-role>${Object.entries(ROLE).map(([k, v]) => html`<option value="${k}" ${(u?.role || 'social') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field ${u?.role === 'outlet' ? '' : 'hidden'}" data-outlet><span>Outlet</span><select class="input" name="outlet_id"><option value="">Choose…</option>${state.outlets.map((o) => html`<option value="${o.id}" ${o.id === u?.outlet_id ? 'selected' : ''}>${o.name}</option>`)}</select></label>
      <label class="field"><span>${u ? 'New password' : 'Password'} ${u ? html`<em>(leave empty to keep)</em>` : ''}</span><input class="input" name="password" type="text" autocomplete="new-password" placeholder="At least 6 characters" /></label>
      <label class="check" style="margin-top:16px"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''} />Can sign in</label>
    </form>`,
    foot: html`${u && u.id !== state.user.id ? html`<button class="btn danger" data-del style="flex:none;width:52px;padding:0">${icon('trash')}</button>` : ''}<button class="btn" data-save>${icon('check', 'sm')}Save</button>`,
  });
  on(s.el, 'change', '[data-role]', (e, t) => s.el.querySelector('[data-outlet]').classList.toggle('hidden', t.value !== 'outlet'));
  on(s.el, 'click', '[data-save]', async () => {
    try { await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: formData(s.el.querySelector('[data-f]')) }); s.close(); toast('Login saved'); changed(); } catch (e) { oops(e); }
  });
  on(s.el, 'click', '[data-del]', async () => {
    if (!(await confirmSheet({ title: `Delete ${u.name}?`, message: 'This login will be permanently removed. Their past activity stays in the history. To pause access, untick "Can sign in" instead.', ok: 'Delete', danger: true }))) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); s.close(); toast('Login deleted'); changed(); } catch (e) { oops(e); }
  });
}

// ───────────── profile / more ─────────────
export function profileView(main, params, links = []) {
  const u = state.user;
  main.innerHTML = String(html`
    <div class="d-hero"><div class="avatar lg ink">${initials(u.name)}</div><div class="grow"><b>${u.name}</b><div class="muted small bold">@${u.username} · ${ROLE[u.role]}${u.outlet_name ? ' · ' + u.outlet_name : ''}</div></div></div>
    ${links.length ? html`<div class="list-card" style="margin-top:12px">${links.map(([href, ic, label]) => html`<a class="li" href="${href}" style="color:inherit"><div class="avatar">${icon(ic, 'sm')}</div><div class="grow t1">${label}</div>${icon('right', 'sm')}</a>`)}</div>` : ''}
    <div class="section"><div class="section-h"><h2>Change password</h2></div>
      <form class="card" data-pw>
        <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" /></label>
        <label class="field"><span>New password</span><input class="input" type="password" name="next" autocomplete="new-password" placeholder="At least 6 characters" /></label>
        <button class="btn block" style="margin-top:14px">${icon('key', 'sm')}Update password</button>
      </form>
    </div>
    <div class="section"><button class="btn danger block" data-logout>${icon('logout', 'sm')}Sign out</button></div>
    <p class="muted tiny" style="text-align:center;margin-top:20px">Qasr Laban Collab Manager</p>
  `);
  on(main, 'submit', '[data-pw]', async (e, f) => {
    e.preventDefault();
    try { await api('/me/password', { method: 'POST', body: formData(f) }); f.reset(); toast('Password updated'); } catch (err) { oops(err); }
  });
  on(main, 'click', '[data-logout]', async () => { await api('/logout', { method: 'POST' }); location.hash = ''; location.reload(); });
}

export { relDay };

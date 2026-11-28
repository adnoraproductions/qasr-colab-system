// Collab card, detail sheet, create/edit form and product picker.
import {
  state, can, api, html, raw, esc, icon, inr, compact, initials, fmtDate, fmtTime, fmtStamp, relDay, today,
  STATUS, statusPill, typePill, openSheet, confirmSheet, toast, oops, on, waLink, productLabel, groupBy, loadLookups,
} from './lib.js';

const DELIVERABLES = ['Reel', 'Story', 'Post', 'YouTube', 'Shorts', 'Live'];
const changed = () => window.dispatchEvent(new Event('ql:changed'));

// ───────────── card ─────────────
// Agenda-style card: the time sits on the left, everything else on the right.
export function collabCard(c, { showDate = false, showOutlet = true } = {}) {
  const items = c.items || [];
  const sub = [showOutlet && c.outlet_name, c.inf_handle && '@' + c.inf_handle, c.inf_followers && compact(c.inf_followers) + ' followers'].filter(Boolean).join(' · ');
  const [clock, ampm] = c.time ? fmtTime(c.time).split(' ') : [];
  return html`
  <button class="collab ${c.status}" data-collab="${c.id}">
    <div class="c-time ${c.time ? '' : 'none'}">${c.time ? html`<b>${clock}</b><span>${ampm}</span>` : html`<b>Any</b><span>time</span>`}${showDate ? html`<span>${relDay(c.date)}</span>` : ''}</div>
    <div class="c-body">
      <div class="c-head"><div class="c-name">${c.inf_name}</div>${statusPill(c.status)}</div>
      ${sub ? html`<div class="c-sub">${sub}</div>` : ''}
      <div class="c-prod ${items.length ? '' : 'warn'}">${items.length ? items.map((i) => `${i.label}\u00a0×${i.qty}`).join('  ·  ') : 'Products not assigned yet'}</div>
      <div class="c-foot">
        ${c.type === 'paid' ? html`<span class="c-type paid">${icon('rupee', 'xs')}Paid${c.amount ? ' · ' + inr(c.amount) : ''}</span>` : html`<span class="c-type">${icon('gift', 'xs')}Barter</span>`}
      </div>
    </div>
  </button>`;
}

export function bindCollabCards(root, onChange) {
  on(root, 'click', '[data-collab]', (e, t) => openCollab(Number(t.dataset.collab), onChange));
}

// ───────────── WhatsApp text ─────────────
function shareText(c) {
  const lines = [
    `*Qasr Laban Collab* — ${c.type === 'paid' ? 'Paid' : 'Barter'}`,
    `📅 ${fmtDate(c.date, true)}${c.time ? ' · ' + fmtTime(c.time) : ''}`,
    `📍 ${c.outlet_name} outlet`,
    `👤 ${c.inf_name}${c.inf_handle ? ` (@${c.inf_handle})` : ''}${c.inf_followers ? ` · ${compact(c.inf_followers)} followers` : ''}`,
  ];
  if (c.inf_url) lines.push(`🔗 ${c.inf_url}`);
  if (c.guests > 1) lines.push(`👥 ${c.guests} people`);
  if (c.items?.length) { lines.push('', '*Products*'); c.items.forEach((i) => lines.push(`• ${i.label} × ${i.qty}`)); }
  if (c.deliverables) lines.push('', `🎬 Deliverables: ${c.deliverables}`);
  if (c.notes) lines.push(`📝 ${c.notes}`);
  return lines.join('\n');
}

// ───────────── detail ─────────────
export async function openCollab(id, onChange) {
  // Keep the open sheet current when a background refresh brings newer data for this collab
  const onRefreshed = (e) => { if (e.detail.path === `/collabs/${id}` && c) { c = e.detail.data; render(); } };
  window.addEventListener('ql:refreshed', onRefreshed);
  const s = openSheet({ title: 'Collab', body: html`<div class="empty">Loading…</div>`, onClose: () => window.removeEventListener('ql:refreshed', onRefreshed) });
  let c;
  const refresh = async () => { c = await api(`/collabs/${id}`); render(); };
  // Instant updates: show the change straight away, confirm with the server, undo if it fails
  const patch = async (body, msg) => {
    const before = c;
    c = { ...c, ...body }; render();
    if (msg) toast(msg);
    try { c = await api(`/collabs/${id}`, { method: 'PATCH', body }); render(); onChange?.(); changed(); }
    catch (e) { c = before; render(); oops(e); }
  };

  function render() {
    const items = c.items || [];
    const total = items.reduce((a, i) => a + i.qty * i.price, 0);
    const off = ['cancelled', 'no_show'].includes(c.status);
    const seeMoney = can('collab.money') || can('collab.items');

    s.set({
      title: relDay(c.date),
      body: html`
      <div class="stack">
        <div class="d-head">
          <div class="grow">
            <div class="d-name">${c.inf_name}</div>
            <div class="d-sub">${[c.inf_handle ? '@' + c.inf_handle : '', c.inf_followers ? compact(c.inf_followers) + ' followers' : ''].filter(Boolean).join(' · ') || c.inf_platform}</div>
          </div>
          ${c.inf_phone ? html`<a class="icon-btn" href="tel:${c.inf_phone}" aria-label="Call">${icon('phone', 'sm')}</a>` : ''}
          ${c.inf_url ? html`<a class="icon-btn" href="${c.inf_url}" target="_blank" rel="noopener" aria-label="Open profile">${icon('insta', 'sm')}</a>` : ''}
        </div>

        ${can('collab.status') ? html`<div class="status-row" data-status>${Object.entries(STATUS).map(([k, v]) => html`<button class="${c.status === k ? 'on' : ''}" data-v="${k}">${v.label}</button>`)}</div>`
        : can('collab.visit') && !off && c.status !== 'posted' ? html`
          <div class="row"><button class="btn green grow" data-visit="completed" ${c.status === 'completed' ? 'disabled' : ''}>${icon('check', 'sm')}${c.status === 'completed' ? 'Visited' : 'Mark visited'}</button><button class="btn light" data-visit="no_show">No show</button></div>`
        : html`<div>${statusPill(c.status)}</div>`}

        <div class="panel">
          <div class="prow"><span>When</span><b>${fmtDate(c.date, true)}${c.time ? ' · ' + fmtTime(c.time) : ''}</b></div>
          <div class="prow"><span>Outlet</span><b>${c.outlet_name}</b></div>
          <div class="prow"><span>Type</span><b>${c.type === 'paid' ? `Paid${c.amount != null ? ' · ' + inr(c.amount) : ''}` : 'Barter'}</b></div>
          ${c.type === 'paid' && can('collab.money') ? html`<div class="prow" style="align-items:center"><span>Payment</span>
            <div class="seg" style="width:180px" data-pay>${['pending', 'paid'].map((p) => html`<button class="${c.payment_status === p ? 'on' : ''}" data-v="${p}">${p === 'paid' ? 'Paid' : 'Pending'}</button>`)}</div></div>` : ''}
          ${c.deliverables ? html`<div class="prow"><span>Deliverables</span><b>${c.deliverables}</b></div>` : ''}
          ${c.guests > 1 ? html`<div class="prow"><span>People</span><b>${c.guests}</b></div>` : ''}
          ${c.notes ? html`<div class="prow stacked"><span>Notes</span><span>${c.notes}</span></div>` : ''}
        </div>

        <div class="panel">
          <div class="panel-h"><span>Products</span>${can('collab.items') ? html`<button class="btn ghost sm" data-assign>${items.length ? 'Change' : html`${icon('plus', 'sm')}Assign`}</button>` : ''}</div>
          ${items.length ? html`
            ${items.map((i) => html`<div class="prow"><span style="color:var(--ink);font-weight:600">${i.label}</span><b class="num">×${i.qty}${seeMoney ? html` <span class="muted" style="font-weight:500">· ${inr(i.price * i.qty)}</span>` : ''}</b></div>`)}
            ${seeMoney ? html`<div class="prow"><span>Total value</span><b class="num">${inr(total)}</b></div>` : ''}`
          : html`<div class="prow"><span>${can('collab.items') ? 'No products assigned yet' : 'Waiting for the manager to assign products'}</span></div>`}
        </div>

        ${can('collab.status') && ['completed', 'posted'].includes(c.status) || c.post_link ? html`
          <div class="panel" style="padding-bottom:14px"><div class="panel-h"><span>Content link</span>${c.post_link ? html`<a class="small" href="${c.post_link}" target="_blank" rel="noopener">Open ${icon('ext', 'xs')}</a>` : ''}</div>
          ${can('collab.status') ? html`<form class="row" data-postlink><input class="input grow" name="post_link" placeholder="Paste reel / post link" value="${c.post_link}" /><button class="btn sm" style="height:48px">Save</button></form>` : ''}</div>` : ''}

        ${c.activity?.length ? html`<details class="history"><summary>History · ${c.activity.length} update${c.activity.length > 1 ? 's' : ''}</summary><div class="timeline">
          ${c.activity.map((a) => html`<div class="ev"><i></i><div><b>${a.action}</b><div class="muted tiny">${a.user_name || 'System'} · ${fmtStamp(a.created_at)}</div></div></div>`)}</div></details>` : ''}
      </div>`,
      foot: html`
        <a class="btn light" href="${waLink(shareText(c))}" target="_blank" rel="noopener" style="flex:none;width:52px;padding:0" aria-label="Share on WhatsApp">${icon('wa')}</a>
        ${can('collab.create') ? html`<button class="btn light" data-dup style="flex:none;width:52px;padding:0" aria-label="Duplicate">${icon('dup')}</button>` : ''}
        ${can('collab.delete') ? html`<button class="btn danger" data-del style="flex:none;width:52px;padding:0" aria-label="Delete">${icon('trash')}</button>` : ''}
        ${can('collab.edit') ? html`<button class="btn" data-edit>${icon('edit', 'sm')}Edit</button>` : html`<button class="btn light" data-close-sheet>Close</button>`}`,
    });
  }

  const el = s.el;
  on(el, 'click', '[data-status] button', (e, b) => b.dataset.v !== c.status && patch({ status: b.dataset.v }, `Marked ${STATUS[b.dataset.v].label}`));
  on(el, 'click', '[data-visit]', (e, b) => patch({ status: b.dataset.visit }, 'Updated'));
  on(el, 'click', '[data-pay] button', (e, b) => b.dataset.v !== c.payment_status && patch({ payment_status: b.dataset.v }, 'Payment updated'));
  on(el, 'submit', '[data-postlink]', (e, f) => { e.preventDefault(); patch({ post_link: f.post_link.value, ...(c.status === 'completed' && f.post_link.value ? { status: 'posted' } : {}) }, 'Link saved'); });
  on(el, 'click', '[data-close-sheet]', () => s.close());
  on(el, 'click', '[data-assign]', () => openProductPicker(c.items.map((i) => ({ product_id: i.product_id, qty: i.qty })), async (items) => {
    try { c = await api(`/collabs/${id}/items`, { method: 'PUT', body: { items } }); render(); toast('Products assigned'); onChange?.(); changed(); } catch (e) { oops(e); }
  }));
  on(el, 'click', '[data-edit]', () => openCollabForm({ collab: c }, async () => { await refresh(); onChange?.(); }));
  on(el, 'click', '[data-dup]', () => duplicate(c, s, onChange));
  on(el, 'click', '[data-del]', async () => {
    if (!(await confirmSheet({ title: 'Delete this collab?', message: `${c.inf_name} at ${c.outlet_name} on ${fmtDate(c.date)} will be permanently removed, including its products and history. To keep it in reports, mark it Cancelled instead.`, ok: 'Delete', danger: true }))) return;
    try { await api(`/collabs/${id}`, { method: 'DELETE' }); s.close(); toast('Collab deleted'); onChange?.(); changed(); } catch (e) { oops(e); }
  });

  try { await refresh(); } catch (e) { oops(e); s.close(); }
}

function duplicate(c, parent, onChange) {
  const s = openSheet({
    title: 'Duplicate collab',
    body: html`<p class="muted small" style="margin:0 2px 12px">Creates a copy for ${c.inf_name} at ${c.outlet_name} with the same products and deliverables.</p>
      <label class="field"><span>New date</span><input class="input" type="date" name="date" value="${c.date}" /></label>`,
    foot: html`<button class="btn" data-go>${icon('dup', 'sm')}Create copy</button>`,
  });
  s.el.querySelector('[data-go]').onclick = async () => {
    try {
      const n = await api(`/collabs/${c.id}/duplicate`, { method: 'POST', body: { date: s.el.querySelector('[name=date]').value } });
      s.close(); parent.close(); toast('Copy created'); onChange?.(); changed(); openCollab(n.id, onChange);
    } catch (e) { oops(e); }
  };
}

// ───────────── create / edit form ─────────────
export function openCollabForm({ collab = null, date = null } = {}, onSaved) {
  const editing = !!collab;
  const f = {
    date: collab?.date || date || today(), time: collab?.time || '', outlet_id: collab?.outlet_id || '',
    type: collab?.type || 'barter', amount: collab?.amount || '', guests: collab?.guests || 1, notes: collab?.notes || '',
    deliverables: collab?.deliverables ? collab.deliverables.split(',').map((x) => x.trim()) : ['Reel'],
    inf: { name: collab?.inf_name || '', profile_url: collab?.inf_url || '', followers: collab?.inf_followers || '', phone: collab?.inf_phone || '' },
    items: collab ? collab.items.map((i) => ({ product_id: i.product_id, qty: i.qty })) : [], itemsTouched: false,
  };
  const outlets = state.outlets.filter((o) => o.active || o.id === f.outlet_id);

  const s = openSheet({ title: editing ? 'Edit collab' : 'New collab', body: '', foot: html`<button class="btn light" data-cancel style="flex:none">Cancel</button><button class="btn" data-save>${icon('check', 'sm')}${editing ? 'Save changes' : 'Schedule collab'}</button>` });
  const el = s.el;

  // Influencer details are typed straight into the collab. Repeat influencers are matched
  // automatically on the server by their handle / profile link, so nobody manages a separate list.
  function influencerBlock() {
    return html`<div class="subcard" style="margin-top:0">
      <label class="field"><span>Name</span><input class="input" data-ni="name" value="${f.inf.name}" placeholder="e.g. Kochi Food Diaries" list="inf-names" autocomplete="off" /></label>
      <datalist id="inf-names">${state.influencers.map((i) => html`<option value="${i.name}">${i.handle ? '@' + i.handle : ''}</option>`)}</datalist>
      <label class="field"><span>Profile link <em>(Instagram / YouTube)</em></span><input class="input" data-ni="profile_url" value="${f.inf.profile_url}" placeholder="instagram.com/username" inputmode="url" autocapitalize="none" /></label>
      <div class="grid2">
        <label class="field"><span>Followers</span><input class="input" data-ni="followers" type="number" inputmode="numeric" value="${f.inf.followers || ''}" placeholder="45000" /></label>
        <label class="field"><span>Phone <em>(optional)</em></span><input class="input" data-ni="phone" type="tel" value="${f.inf.phone}" /></label>
      </div>
    </div>`;
  }

  function itemsBlock() {
    if (!can('collab.items')) return editing ? '' : html`<p class="note" style="margin-top:16px">Products will be assigned by the manager.</p>`;
    const map = new Map(state.products.map((p) => [p.id, p]));
    const sel = f.items.filter((i) => map.has(i.product_id));
    const total = sel.reduce((a, i) => a + map.get(i.product_id).price * i.qty, 0);
    return html`<div class="field" style="margin-top:16px"><span>Products</span></div>
      <div class="card" style="padding:12px 14px">
        ${sel.length ? html`<div class="items" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${sel.map((i) => html`<span class="pill">${productLabel(map.get(i.product_id))} ×${i.qty}</span>`)}</div>
          <div class="row between"><span class="muted small bold">${sel.reduce((a, i) => a + i.qty, 0)} items · ${inr(total)}</span><button type="button" class="btn ghost sm" data-pick>${icon('edit', 'sm')}Change</button></div>`
        : html`<button type="button" class="btn ghost block" data-pick>${icon('plus', 'sm')}Choose products</button>`}
      </div>`;
  }

  function render() {
    s.set({ body: html`
      <form data-form autocomplete="off">
        <div class="grid2">
          <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${f.date}" required /></label>
          <label class="field"><span>Time <em>(optional)</em></span><input class="input" type="time" name="time" value="${f.time}" /></label>
        </div>
        <label class="field"><span>Outlet</span>
          <select class="input" name="outlet_id" required><option value="">Choose outlet…</option>${outlets.map((o) => html`<option value="${o.id}" ${o.id == f.outlet_id ? 'selected' : ''}>${o.name}${o.district ? ` — ${o.district}` : ''}</option>`)}</select></label>
        <div class="field"><span>Influencer</span>${influencerBlock()}</div>
        <div class="field"><span>Collab type</span>
          <div class="seg" data-type>${[['barter', 'gift', 'Barter'], ['paid', 'rupee', 'Paid']].map(([v, ic, l]) => html`<button type="button" class="${f.type === v ? 'on' : ''}" data-v="${v}">${icon(ic, 'sm')}${l}</button>`)}</div></div>
        <label class="field ${f.type === 'paid' ? '' : 'hidden'}" data-amount><span>Amount paid to influencer (₹)</span><input class="input" type="number" inputmode="numeric" name="amount" value="${f.amount}" placeholder="e.g. 3000" /></label>
        <div class="field"><span>Deliverables</span><div class="toggle-chips" data-deliv>${DELIVERABLES.map((d) => html`<button type="button" class="${f.deliverables.includes(d) ? 'on' : ''}" data-v="${d}">${d}</button>`)}</div></div>
        <div class="grid2">
          <label class="field"><span>People visiting</span><input class="input" type="number" min="1" max="50" inputmode="numeric" name="guests" value="${f.guests}" /></label>
          <div></div>
        </div>
        <label class="field"><span>Notes <em>(optional)</em></span><textarea class="input" name="notes" placeholder="Content brief, timing, special requests…">${f.notes}</textarea></label>
        <div data-items>${itemsBlock()}</div>
      </form>` });
  }

  const sync = () => { const fm = el.querySelector('[data-form]'); if (!fm) return; f.date = fm.date.value; f.time = fm.time.value; f.outlet_id = fm.outlet_id.value; f.amount = fm.amount.value; f.guests = fm.guests.value; f.notes = fm.notes.value; };
  const setNi = (k, v) => { f.inf[k] = v; const i = el.querySelector(`[data-ni=${k}]`); if (i) i.value = v; };
  on(el, 'input', '[data-ni]', (e, t) => { f.inf[t.dataset.ni] = t.value; });
  // Picking a previous influencer's name fills the rest of their details
  on(el, 'change', '[data-ni=name]', (e, t) => {
    const m = state.influencers.find((i) => i.name.toLowerCase() === t.value.trim().toLowerCase());
    if (!m) return;
    if (!f.inf.profile_url && m.profile_url) setNi('profile_url', m.profile_url);
    if (!f.inf.followers && m.followers) setNi('followers', m.followers);
    if (!f.inf.phone && m.phone) setNi('phone', m.phone);
  });
  // Pasting a profile link fills the name from the @handle if it is still empty
  on(el, 'change', '[data-ni=profile_url]', (e, t) => {
    const h = (t.value.match(/(?:instagram\.com|youtube\.com\/@?)\/?([A-Za-z0-9._-]+)/i) || [])[1];
    if (h && !f.inf.name.trim()) setNi('name', h);
  });
  on(el, 'click', '[data-type] button', (e, b) => {
    f.type = b.dataset.v; el.querySelectorAll('[data-type] button').forEach((x) => x.classList.toggle('on', x === b));
    el.querySelector('[data-amount]').classList.toggle('hidden', f.type !== 'paid');
  });
  on(el, 'click', '[data-deliv] button', (e, b) => { const v = b.dataset.v; f.deliverables = f.deliverables.includes(v) ? f.deliverables.filter((x) => x !== v) : [...f.deliverables, v]; b.classList.toggle('on'); });
  on(el, 'click', '[data-pick]', () => openProductPicker(f.items, (items) => { f.items = items; f.itemsTouched = true; el.querySelector('[data-items]').innerHTML = String(itemsBlock()); }));
  on(el, 'click', '[data-cancel]', () => s.close());
  on(el, 'submit', '[data-form]', (e) => e.preventDefault());

  on(el, 'click', '[data-save]', async (e, btn) => {
    sync();
    if (!f.outlet_id) return toast('Please choose an outlet', 'err');
    if (!f.inf.name.trim() && !f.inf.profile_url.trim()) return toast("Enter the influencer's name or profile link", 'err');
    if (f.type === 'paid' && !(Number(f.amount) > 0)) return toast('Enter the amount for the paid collab', 'err');
    const body = { date: f.date, time: f.time, outlet_id: Number(f.outlet_id), type: f.type, amount: f.amount, guests: f.guests, notes: f.notes, deliverables: f.deliverables,
      influencer: f.inf };
    if (!editing && can('collab.items')) body.items = f.items;
    btn.disabled = true;
    try {
      const saved = editing ? await api(`/collabs/${collab.id}`, { method: 'PUT', body }) : await api('/collabs', { method: 'POST', body });
      if (editing && f.itemsTouched && can('collab.items')) await api(`/collabs/${collab.id}/items`, { method: 'PUT', body: { items: f.items } });
      await loadLookups();
      s.close(); toast(editing ? 'Collab updated' : 'Collab scheduled'); changed(); onSaved?.(saved);
    } catch (err) { oops(err); btn.disabled = false; }
  });

  render();
}

// ───────────── product picker ─────────────
export function openProductPicker(initial, onDone) {
  const qty = new Map(initial.map((i) => [i.product_id, i.qty]));
  let q = '';
  const products = state.products.filter((p) => p.active || qty.has(p.id));
  const s = openSheet({ title: 'Assign products', body: '', foot: '' });

  function list() {
    const qq = q.toLowerCase();
    const shown = products.filter((p) => !qq || p.name.toLowerCase().includes(qq));
    return shown.length ? html`<div class="pp-cat">${shown.map((p) => { const n = qty.get(p.id) || 0; return html`<div class="pp-item ${n ? 'sel' : ''}" data-pid="${p.id}"><div class="nm">${p.name}<div class="pr">${inr(p.price)}</div></div>
        <div class="stepper"><button type="button" class="minus" data-d="-1" aria-label="Less">−</button><b>${n}</b><button type="button" class="plus" data-d="1" aria-label="More">+</button></div></div>`; })}</div>`
      : html`<div class="empty">No products match “${q}”.</div>`;
  }
  function foot() {
    const map = new Map(products.map((p) => [p.id, p]));
    let n = 0, v = 0; for (const [id, c] of qty) { n += c; v += (map.get(id)?.price || 0) * c; }
    s.set({ foot: html`<div class="grow" style="align-self:center"><div class="bold">${n} item${n === 1 ? '' : 's'}</div><div class="muted small">${inr(v)} value</div></div>${n ? html`<button class="btn light" data-clear style="flex:none">Clear</button>` : ''}<button class="btn" data-done style="flex:none;min-width:120px">Done</button>` });
  }
  s.set({ body: html`<div class="search" style="position:sticky;top:0;z-index:2;background:var(--bg);padding-bottom:4px">${icon('search', 'sm')}<input class="input" placeholder="Search products…" data-pq /></div><div data-plist>${list()}</div>` });
  foot();

  on(s.el, 'input', '[data-pq]', (e, t) => { q = t.value; s.el.querySelector('[data-plist]').innerHTML = String(list()); });
  on(s.el, 'click', '.stepper button', (e, b) => {
    const row = b.closest('[data-pid]'); const id = Number(row.dataset.pid);
    const n = Math.max(0, Math.min(99, (qty.get(id) || 0) + Number(b.dataset.d)));
    if (n) qty.set(id, n); else qty.delete(id);
    row.classList.toggle('sel', !!n); row.querySelector('b').textContent = n; foot();
  });
  on(s.el, 'click', '[data-clear]', () => { qty.clear(); s.el.querySelector('[data-plist]').innerHTML = String(list()); foot(); });
  on(s.el, 'click', '[data-done]', () => { onDone([...qty].map(([product_id, q]) => ({ product_id, qty: q }))); s.close(); });
}

export { esc, raw };

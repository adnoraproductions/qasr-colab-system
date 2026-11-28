// Outlet lists: after products are assigned, the manager shares one list per outlet
// and one combined kitchen list — as an image, WhatsApp text, or a printable PDF.
import { state, api, html, icon, compact, fmtDate, fmtTime, relDay, today, addDays, groupBy, on, toast, oops, emptyState, waLink } from './lib.js';

const ACTIVE = (c) => !['cancelled', 'no_show'].includes(c.status);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const countLabel = (L) => `${plural(L.ready.length, 'collab')} · ${plural(L.outlets.length, 'outlet')}`;
const qtyLine = (items) => items.map((i) => `${i.label} × ${i.qty}`).join(', ');

// ───────────── data ─────────────
function buildLists(collabs) {
  const live = collabs.filter(ACTIVE);
  const ready = live.filter((c) => c.items.length);
  const missing = live.filter((c) => !c.items.length);
  const outlets = Object.values(groupBy(ready, (c) => c.outlet_id))
    .map((cs) => ({ id: cs[0].outlet_id, name: cs[0].outlet_name, collabs: cs, phone: state.outlets.find((o) => o.id === cs[0].outlet_id)?.phone || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totals = new Map();
  for (const c of ready) for (const i of c.items) totals.set(i.label, (totals.get(i.label) || 0) + i.qty);
  const kitchen = [...totals].map(([label, qty]) => ({ label, qty })).sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label));
  const perOutlet = outlets.map((o) => {
    const m = new Map();
    for (const c of o.collabs) for (const i of c.items) m.set(i.label, (m.get(i.label) || 0) + i.qty);
    return { name: o.name, items: [...m].map(([label, qty]) => ({ label, qty })) };
  });
  return { ready, missing, outlets, kitchen, perOutlet, itemCount: kitchen.reduce((a, k) => a + k.qty, 0) };
}

// ───────────── WhatsApp text ─────────────
function outletText(o, date) {
  const lines = [`*Qasr Laban — ${o.name}*`, `Collabs on ${fmtDate(date, true)}`, ''];
  o.collabs.forEach((c, n) => {
    lines.push(`*${n + 1}. ${c.time ? fmtTime(c.time) + ' · ' : ''}${c.inf_name}*${c.inf_handle ? ` (@${c.inf_handle})` : ''}`);
    lines.push(`   ${qtyLine(c.items)}`);
    const extra = [c.guests > 1 && `${c.guests} people`, c.deliverables].filter(Boolean).join(' · ');
    if (extra) lines.push(`   ${extra}`);
    if (c.notes) lines.push(`   Note: ${c.notes}`);
  });
  return lines.join('\n');
}
function kitchenText(L, date) {
  const lines = [`*Qasr Laban — Kitchen list*`, `${fmtDate(date, true)} · ${countLabel(L)}`, '', '*Total to prepare*'];
  L.kitchen.forEach((k) => lines.push(`• ${k.label} × ${k.qty}`));
  lines.push('', '*By outlet*');
  L.perOutlet.forEach((o) => lines.push(`${o.name}: ${qtyLine(o.items)}`));
  return lines.join('\n');
}

// ───────────── image (canvas) ─────────────
const W = 1080, PAD = 64;
const F = (w, s) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;
let logoImg;
const loadLogo = () => logoImg || (logoImg = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '/assets/logo-white.png'; }));

function wrap(ctx, text, maxW) {
  const words = String(text).split(' '); const out = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}

// rows: {type:'h', text} | {type:'item', title, right, meta, body, note} | {type:'row', left, right}
async function renderImage({ title, subtitle, rows }) {
  await Promise.all(['500', '600', '700'].map((w) => document.fonts.load(F(w, 32)).catch(() => {})));
  const logo = await loadLogo();
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const inner = W - PAD * 2;

  const pass = (draw) => {
    let y = 0;
    // header
    if (draw) {
      ctx.fillStyle = '#000ade'; ctx.fillRect(0, 0, W, 300);
      if (logo) { const h = 92; ctx.drawImage(logo, PAD, 52, (logo.width / logo.height) * h, h); }
      ctx.fillStyle = '#fff'; ctx.font = F(700, 56); ctx.fillText(title, PAD, 220);
      ctx.globalAlpha = 0.8; ctx.font = F(500, 30); ctx.fillText(subtitle, PAD, 266); ctx.globalAlpha = 1;
    }
    y = 300 + 24;
    const text = (str, font, color, x, yy, align = 'left') => { if (!draw) return; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(str, x, yy); ctx.textAlign = 'left'; };
    const divider = () => { if (draw) { ctx.fillStyle = '#eaebf1'; ctx.fillRect(PAD, y, inner, 2); } };

    for (const r of rows) {
      if (r.type === 'h') {
        y += 44; text(r.text.toUpperCase(), F(700, 24), '#7a7e9e', PAD, y); y += 22;
      } else if (r.type === 'row') {
        y += 50; text(r.left, F(600, 32), '#0b0d2e', PAD, y); text(r.right, F(700, 32), '#000ade', W - PAD, y, 'right'); y += 24; divider();
      } else {
        y += 54;
        ctx.font = F(700, 36);
        const rightW = r.right ? (ctx.font = F(600, 30), ctx.measureText(r.right).width + 24) : 0;
        ctx.font = F(700, 36);
        const t = wrap(ctx, r.title, inner - rightW)[0];
        text(t, F(700, 36), '#0b0d2e', PAD, y);
        if (r.right) text(r.right, F(600, 30), '#000ade', W - PAD, y, 'right');
        if (r.meta) { y += 42; text(r.meta, F(500, 27), '#7a7e9e', PAD, y); }
        ctx.font = F(600, 31);
        for (const l of wrap(ctx, r.body, inner)) { y += 46; text(l, F(600, 31), '#3c4066', PAD, y); }
        if (r.note) { ctx.font = F(500, 27); for (const l of wrap(ctx, 'Note: ' + r.note, inner)) { y += 38; text(l, F(500, 27), '#7a7e9e', PAD, y); } }
        y += 30; divider();
      }
    }
    y += 70; text(`Qasr Laban · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, F(500, 24), '#a3a6bf', W / 2, y, 'center');
    return y + 50;
  };

  c.width = W; c.height = 400; // temporary, for measuring
  const H = pass(false);
  c.width = W; c.height = H;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  pass(true);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

const outletImage = (o, date) => renderImage({
  title: o.name, subtitle: `${fmtDate(date, true)} · ${o.collabs.length} collab${o.collabs.length > 1 ? 's' : ''}`,
  rows: o.collabs.map((c) => ({
    type: 'item', title: c.inf_name, right: c.time ? fmtTime(c.time) : '',
    meta: [c.inf_handle && '@' + c.inf_handle, c.inf_followers && compact(c.inf_followers) + ' followers', c.guests > 1 && c.guests + ' people', c.deliverables].filter(Boolean).join(' · '),
    body: qtyLine(c.items), note: c.notes,
  })),
});
const kitchenImage = (L, date) => renderImage({
  title: 'Kitchen list', subtitle: `${fmtDate(date, true)} · ${countLabel(L)}`,
  rows: [{ type: 'h', text: 'Total to prepare' }, ...L.kitchen.map((k) => ({ type: 'row', left: k.label, right: `× ${k.qty}` })),
    { type: 'h', text: 'By outlet' }, ...L.perOutlet.map((o) => ({ type: 'item', title: o.name, body: qtyLine(o.items) }))],
});

async function shareFile(blob, name, text) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadFile(blob, name);
}
function downloadFile(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Image downloaded');
}

// ───────────── printable sheets ─────────────
const printSheets = (L, date) => html`
  <div class="print-sheet">
    <div class="print-head"><img src="/assets/logo-blue.png" alt="" /><div style="text-align:right"><b style="font-size:18px">Kitchen list</b><div class="muted">${fmtDate(date, true)} · ${countLabel(L)}</div></div></div>
    <h3 class="ps-h">Total to prepare</h3>
    <table class="t"><tbody>${L.kitchen.map((k) => html`<tr><td><b>${k.label}</b></td><td class="r"><b>× ${k.qty}</b></td></tr>`)}</tbody></table>
    <h3 class="ps-h">By outlet</h3>
    <table class="t"><tbody>${L.perOutlet.map((o) => html`<tr><td><b>${o.name}</b></td><td>${qtyLine(o.items)}</td></tr>`)}</tbody></table>
  </div>
  ${L.outlets.map((o) => html`<div class="print-sheet">
    <div class="print-head"><img src="/assets/logo-blue.png" alt="" /><div style="text-align:right"><b style="font-size:18px">${o.name}</b><div class="muted">${fmtDate(date, true)} · ${o.collabs.length} collab${o.collabs.length > 1 ? 's' : ''}</div></div></div>
    <table class="t"><thead><tr><th>Time</th><th>Influencer</th><th>Products</th><th>Details</th></tr></thead><tbody>
      ${o.collabs.map((c) => html`<tr><td>${c.time ? fmtTime(c.time) : '—'}</td><td><b>${c.inf_name}</b>${c.inf_handle ? html`<div class="muted tiny">@${c.inf_handle}</div>` : ''}</td><td><b>${qtyLine(c.items)}</b></td>
        <td class="small">${[c.guests > 1 && c.guests + ' people', c.deliverables, c.notes].filter(Boolean).join(' · ')}</td></tr>`)}
    </tbody></table>
  </div>`)}`;

// ───────────── view ─────────────
export async function listsView(main, params) {
  const t = today(); const tm = addDays(t, 1);
  const date = params.date || t;
  const L = buildLists(await api(`/collabs?from=${date}&to=${date}`));

  const actions = (key, wa) => html`<div class="row" style="gap:8px;margin-top:14px">
    <button class="btn ghost sm grow" data-share="${key}">${icon('send', 'sm')}Share image</button>
    <a class="btn light sm" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp text" title="WhatsApp text">${icon('wa', 'sm')}</a>
    <button class="btn light sm" data-dl="${key}" aria-label="Download image" title="Download image">${icon('download', 'sm')}</button></div>`;

  main.innerHTML = String(html`
    <div class="no-print">
      <div class="row" style="gap:8px">
        <div class="chips grow">
          <button class="chip ${date === t ? 'on' : ''}" data-date="${t}">Today</button>
          <button class="chip ${date === tm ? 'on' : ''}" data-date="${tm}">Tomorrow</button>
          ${date !== t && date !== tm ? html`<button class="chip on">${fmtDate(date)}</button>` : ''}
        </div>
        <label class="icon-btn" aria-label="Pick date" style="position:relative;overflow:hidden">${icon('calendar', 'sm')}<input type="date" data-pick value="${date}" style="position:absolute;inset:0;opacity:0" /></label>
      </div>

      <p class="note" style="margin:12px 2px 0">${relDay(date)} · ${L.outlets.length} outlet${L.outlets.length === 1 ? '' : 's'} · ${L.ready.length} collab${L.ready.length === 1 ? '' : 's'} · ${L.itemCount} items</p>

      ${L.missing.length ? html`<div class="attn" style="margin-top:12px"><a href="#/schedule?date=${date}"><span class="n">${L.missing.length}</span><span class="grow">${L.missing.length > 1 ? 'Collabs still need' : 'Collab still needs'} products — not in these lists yet</span>${icon('right', 'sm')}</a></div>` : ''}

      ${L.ready.length ? html`
        <div class="section">
          <div class="card" style="background:var(--ink);color:#fff;box-shadow:none">
            <div class="row between"><div><div class="bold" style="font-size:17px">Kitchen list</div><div class="small" style="opacity:.65">All outlets · ${L.itemCount} items to prepare</div></div>${icon('box')}</div>
            <div style="margin-top:12px">${L.kitchen.slice(0, 6).map((k) => html`<div class="row between small" style="padding:5px 0;border-top:1px solid rgba(255,255,255,.1)"><span>${k.label}</span><b>× ${k.qty}</b></div>`)}
              ${L.kitchen.length > 6 ? html`<div class="small" style="opacity:.6;padding-top:6px">+ ${L.kitchen.length - 6} more</div>` : ''}</div>
            <div class="row" style="gap:8px;margin-top:14px">
              <button class="btn sm grow" style="background:#fff;color:var(--ink)" data-share="kitchen">${icon('send', 'sm')}Share image</button>
              <a class="btn sm" style="background:rgba(255,255,255,.12)" href="${waLink(kitchenText(L, date))}" target="_blank" rel="noopener" aria-label="WhatsApp text">${icon('wa', 'sm')}</a>
              <button class="btn sm" style="background:rgba(255,255,255,.12)" data-dl="kitchen" aria-label="Download image">${icon('download', 'sm')}</button>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-h"><h2>Outlet lists</h2><button class="link" data-print>${icon('print', 'xs')} Print all</button></div>
          <div class="grid-cards">${L.outlets.map((o) => html`<div class="card">
            <div class="row between"><div class="bold" style="font-size:16px">${o.name}</div><span class="muted small">${o.collabs.length} collab${o.collabs.length > 1 ? 's' : ''}</span></div>
            ${o.collabs.map((c) => html`<div style="padding:10px 0 0">
              <div class="row between small"><b>${c.inf_name}</b><span class="muted">${c.time ? fmtTime(c.time) : ''}</span></div>
              <div class="small" style="color:var(--ink-2)">${qtyLine(c.items)}</div></div>`)}
            ${actions(o.id, waLink(outletText(o, date), o.phone))}
          </div>`)}</div>
          ${L.outlets.some((o) => !o.phone) ? html`<p class="note">Add a WhatsApp number to an outlet (More → Outlets) to send its list straight to that shop.</p>` : ''}
        </div>`
      : html`<div class="section"><div class="card">${emptyState('send', 'No lists for this day', L.missing.length ? 'Assign products to the scheduled collabs first.' : 'No collabs are scheduled for this date.')}</div></div>`}
    </div>
    <div class="print-only">${L.ready.length ? printSheets(L, date) : ''}</div>
  `);

  const make = (key) => (key === 'kitchen' ? kitchenImage(L, date) : outletImage(L.outlets.find((o) => String(o.id) === key), date));
  const fname = (key) => `qasr-laban-${key === 'kitchen' ? 'kitchen' : slug(L.outlets.find((o) => String(o.id) === key).name)}-${date}.png`;
  const text = (key) => (key === 'kitchen' ? kitchenText(L, date) : outletText(L.outlets.find((o) => String(o.id) === key), date));
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { oops(e); } finally { btn.disabled = false; } };

  on(main, 'click', '[data-date]', (e, b) => { location.hash = `#/lists?date=${b.dataset.date}`; });
  on(main, 'change', '[data-pick]', (e, i) => { if (i.value) location.hash = `#/lists?date=${i.value}`; });
  on(main, 'click', '[data-share]', (e, b) => busy(b, async () => shareFile(await make(b.dataset.share), fname(b.dataset.share), text(b.dataset.share))));
  on(main, 'click', '[data-dl]', (e, b) => busy(b, async () => downloadFile(await make(b.dataset.dl), fname(b.dataset.dl))));
  on(main, 'click', '[data-print]', () => window.print());
}

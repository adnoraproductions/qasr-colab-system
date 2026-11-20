# Qasr Laban — Collab Manager

A mobile-first web app for managing Qasr Laban's **barter and paid influencer collabs** across all outlets. It covers scheduling, product assignment by the manager, outlet visibility and reporting.

There are no dependencies to install. It runs on Node.js alone and stores everything in one SQLite file.

## Who uses what

| Role | Can do |
|---|---|
| **Manager** (admin) | Everything: assign products to collabs, share outlet & kitchen lists, manage outlets, the menu and team logins, delete collabs |
| **Social media** | Schedule and edit collabs, update status and payment, add content links, see reports |
| **Outlet** | Own outlet's schedule only, mark visits as done or no-show |
| **Outlet link** (no login) | Each outlet has a private read-only link (`/o/…`) you can send on WhatsApp |

Outlet users never see money (paid amounts, influencer phone numbers).

## Features

- **Schedule**: a swipeable date strip with per-day counts, plus Upcoming and All lists. Filter by outlet, type, status or text
- **Collabs**: date, time, outlet, influencer details typed right in the form (name, profile link, followers, phone; repeat influencers are recognised automatically by their handle or link), barter or paid with amount, deliverables (Reel / Story / Post…), number of people, notes
- **Product assignment**: the menu picker shows qty steppers and the live total value. Prices are snapshotted when products are assigned, so later menu price changes don't rewrite history
- **Outlet lists** (manager): once products are assigned, pick a day and share a separate list for each outlet plus one combined **kitchen list** (total qty per product, and per outlet). Each list can go out as a branded image (phone share sheet → WhatsApp), as WhatsApp text (straight to the outlet's number if saved), or all together via **Print all → PDF**, one page per shop
- **Status flow**: Scheduled → Confirmed → Visited → Posted (or Cancelled / No show). Pasting the reel link marks the collab Posted
- **Payment tracking** for paid collabs (Pending / Paid)
- **WhatsApp share** for any collab, and a duplicate option for repeat collabs
- **Activity log** on every collab: who did what, and when
- **Reports** for any date range, outlet or type:
  - investment, product value, paid amount (settled / due), cost per collab, estimated reach, posted rate
  - collabs per day, status breakdown
  - tables by outlet, by influencer and by product, plus outlets with no collabs
  - export to **Excel/CSV**, or **Print / PDF** with the Qasr Laban header
- **Outlets, menu and team** management. The 25 outlets and the full menu are preloaded
- Installable on the phone home screen (PWA)

## Run it

Requires **Node.js 22.13 or newer** (check with `node -v`).

```bash
npm start
```

Open http://localhost:3000.

**First login:** username `admin`. On the very first start the server prints the admin password in its log. To choose it yourself, set `ADMIN_PASSWORD` before the first start:

```bash
ADMIN_PASSWORD='your-strong-password' npm start
```

After signing in, change it from **More → Profile → Change password**, and add logins for your team under **More → Team**.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/qasr.db` | Database file location |
| `COOKIE_SECURE` | off | Set to `1` when served over HTTPS |
| `ADMIN_PASSWORD` | random | Password for the first `admin` login (used only when the database is first created) |

## Deploying

Any host that runs Node and keeps a **persistent disk** will work: a small VPS (Hetzner, DigitalOcean, Lightsail), Railway or Render with a volume, and so on.

1. Copy the project to the server, then run `npm start` (use `pm2` or systemd to keep it running).
2. Put it behind HTTPS (Caddy or Nginx) and set `COOKIE_SECURE=1`.
3. Point `DB_PATH` at the persistent volume.

Serverless platforms like Vercel or Netlify won't work, because they don't keep the database file.

**Backups:** everything lives in the one file at `DB_PATH`. Copy it (plus `qasr.db-wal` if present) on a schedule, for example a daily cron job to cloud storage.

## Project layout

```
server.js            HTTP server, REST API, permissions, reports, CSV
src/db.js            SQLite schema + first-run seeding
src/auth.js          Password hashing + role permissions
src/seed-data.js     Outlets, menu & first admin login
public/              Front-end (no build step)
  js/app.js          Shell, routing, login, outlet share page
  js/views.js        Dashboard, schedule
  js/lists.js        Outlet & kitchen lists: share images, WhatsApp text, print
  js/collab.js       Collab card, detail, form, product picker
  js/admin.js        Reports, outlets, menu, team, profile
  css/app.css        Design system
  assets/            Logos, menu card, app icons
```

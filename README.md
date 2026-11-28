# Qasr Laban — Collab Manager

A mobile-first web app for managing Qasr Laban's **barter and paid influencer collabs** across all outlets. It covers scheduling, product assignment by the manager, outlet visibility and reporting.

It runs on Node.js and stores everything in SQLite: a local file when you run it on your computer, or **Turso** when it's deployed on Vercel.

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
npm install
```
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
| `DB_PATH` | `./data/qasr.db` | Database file location (when not using Turso) |
| `TURSO_DATABASE_URL` | — | Use a Turso database instead of the local file |
| `TURSO_AUTH_TOKEN` | — | Turso database token |
| `COOKIE_SECURE` | off | Set to `1` when served over HTTPS |
| `APP_TZ` | `Asia/Kolkata` | Time zone used to decide what "today" is |
| `ADMIN_PASSWORD` | random | Password for the first `admin` login (used only when the database is first created) |

## Deploying on Vercel + Turso (free)

On Vercel the pages are served as static files, the API runs as a Vercel Function, and the data lives in **Turso**, a hosted SQLite-compatible database. Both have free plans that are plenty for a team this size (check their current limits).

### 1. Put the code on GitHub
The site deploys straight from the GitHub repository, and every later push to `main` redeploys it automatically.

### 2. Create the Turso database
1. Sign up at **turso.tech**.
2. Create a database. Pick the location closest to Kerala, such as **Mumbai** (`aws-ap-south-1`) if it's offered.
3. On the database page, copy the **Database URL** (it starts with `libsql://`).
4. Create a **database token** and copy it. Keep it private, like a password.

### 3. (Optional) Copy your existing data into Turso
If you've already been using the app on this computer, copy everything into the new, empty Turso database. Run this once, from the project folder:

```bash
TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' npm run copy-to-turso
```

Logins keep their passwords, but everyone needs to sign in once on the new site. The script refuses to run if Turso already has data, so it can't overwrite anything. Skip this step to start fresh.

### 4. Create the Vercel project
1. On **vercel.com**: **Add New → Project**, then import this GitHub repository.
2. Leave **Framework Preset** as **Other** and the build settings empty. `vercel.json` already sets everything.
3. Under **Environment Variables**, add:
   - `TURSO_DATABASE_URL`: the URL from step 2
   - `TURSO_AUTH_TOKEN`: the token from step 2
   - `ADMIN_PASSWORD`: only if you skipped step 3. This is the first `admin` login's password.
4. Click **Deploy**. When it finishes, open the `….vercel.app` address and sign in.

You can connect your own domain later under **Settings → Domains**. If you add or change an environment variable later, redeploy for it to take effect.

### Other hosts
Any server that runs Node 22.13+ also works. Run `npm install` and `npm start`. Without `TURSO_DATABASE_URL`, the app keeps its data in the local file at `DB_PATH`, so the server must keep its disk. Back up that file regularly.

## Project layout

```
server.js            Local server: static files + API
vercel.json          Vercel build, rewrites and headers
api/index.mjs        The API as a Vercel Function
src/api.js           REST API: routes, permissions, reports, CSV
src/db.js            Database (local SQLite or Turso), schema, first-run seeding
scripts/             copy-to-turso.mjs: one-time data copy
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

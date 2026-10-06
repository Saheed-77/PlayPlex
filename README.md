# PlayPlex

Gaming-room operations for a college event. Reception registers students and takes payment,
volunteers assign them to free stations and run the timers, and admin manages devices, pricing,
staff and reporting. Every board updates live, without anyone pressing refresh.

The specs in [`docs/`](docs/) are the source of truth — start with [`docs/README.md`](docs/README.md).

## Branches

| Branch | What it is |
|---|---|
| `main` | The project: specs plus the `frontend/` app |
| `demo` | **This branch.** `main` plus the Netlify/Vercel config below, for hosting the clickable demo |

## The demo

The frontend is the real app, running against a **backend that lives in the browser** — no server,
no database. It seeds a believable mid-event room (about five hours of history, an overdue laptop,
a queue of 12, dues outstanding) and enforces the same rules as the API spec: queue order, the
assign guards, idempotency keys, price snapshots, the payment ledger and the audit log.

Each visitor gets their own copy in their own browser storage. Nothing is shared between
visitors, and no data leaves the browser.

Sign in with `priya` (reception), `meera` (volunteer) or `admin` — password `demo1234` for all
of them. The login screen lists the accounts, so anyone with the link can look around.

**Presenting it?** Add `?demo=1` to the URL (e.g. `https://your-site.netlify.app/?demo=1`) and a
**Demo** button appears in the bottom-left corner: switch roles without signing out, turn on
simulated traffic, speed the clock up so timers run down while you watch, fake a dropped
connection, and reset the data. It stays on for that browser tab; `?demo=0` turns it off. Plain
visitors never see it, so nobody can reset the room from under you.

Run it locally:

```bash
cd frontend
npm install
npm run dev
```

More detail, including how to point the same UI at the real backend, is in
[`frontend/README.md`](frontend/README.md).

## Hosting this branch

Push the repo first, then:

**Netlify** — *Add new site → Import an existing project*, pick the repo, and set the production
branch to `demo`. `netlify.toml` already supplies the base directory (`frontend`), the build
command and the publish directory, so leave those as they are detected.

**Vercel** — *Add New → Project*, import the repo, and deploy. `vercel.json` supplies the install
and build commands and the output directory. Then set the production branch to `demo` under
*Settings → Git* and redeploy.

Either way, pushing to `demo` rebuilds the site.

**No repo yet?** Build it and drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop):

```bash
cd frontend && npm install && npm run build   # produces frontend/dist
```

Both platforms need the single-page-app fallback that `frontend/public/_redirects`,
`netlify.toml` and `vercel.json` provide — without it, opening `/admin/reports` directly, or
refreshing any page other than the root, returns a 404.

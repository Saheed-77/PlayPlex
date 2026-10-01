# 08 — Event-Day Runbook

Print this. Put a copy at reception, a copy with the admin, and a copy in the box with
the paper fallback sheets.

---

## 1. Roles on the day

| Role | People | Where | Device |
|---|---|---|---|
| **Event lead / Admin** | 1 | Roaming | Laptop |
| **Tech owner** | 1 (you) | On call | Laptop with SSH/Docker access |
| **Reception** | 1–2 | Door | Laptop + cash box |
| **Floor volunteers** | 2–3 | In the room | Phone or tablet each |

**Everyone must know one thing:** if the app is unreachable, switch to the paper
fallback in §6 immediately and tell the tech owner. Do not stand around waiting.

---

## 2. Opening checklist (T−30 minutes)

### Tech owner

| ✓ | Step | Verify |
|---|---|---|
| ☐ | Server laptop on, **wired Ethernet**, plugged into the **UPS** | Ping it from a phone |
| ☐ | `docker compose ps` — all three services `Up` | `db` shows `healthy` |
| ☐ | Open `https://<server-ip>/actuator/health` | `{"status":"UP"}` |
| ☐ | Backup job running | A dump file with today's timestamp exists |
| ☐ | Log in as admin on the admin laptop | Dashboard loads, `[●] Live` is green |
| ☐ | Every staff device loads the app and has the root cert installed | No certificate warnings anywhere |

### Admin

| ✓ | Step |
|---|---|
| ☐ | **Devices** — all 13 `AVAILABLE`, yesterday's faults resolved or still flagged |
| ☐ | **Plans** — correct prices active, confirmed with the committee |
| ☐ | **Staff** — today's volunteers exist, are active, and know their passwords |
| ☐ | **Settings** — warning threshold, extension cap, and today's **opening cash float** entered |
| ☐ | Yesterday's dues cleared or written off (day 2+) |

### Reception

| ✓ | Step |
|---|---|
| ☐ | Logged in, register form loads, phone field is focused |
| ☐ | Cash box counted; the count matches the opening float entered in Settings |
| ☐ | UPI QR code displayed at the desk |
| ☐ | Ticket slips and two pens ready |
| ☐ | Paper fallback sheets within reach |

### Volunteers

| ✓ | Step |
|---|---|
| ☐ | Each logged in on their own device, floor board loads, `[●] Live` green |
| ☐ | Devices charged, brightness up, **screen auto-lock set to 5 minutes or off** |
| ☐ | Every station physically checked: powered, controllers charged, headsets working |
| ☐ | Cheat sheet read (§3) |

---

## 3. Volunteer cheat sheet — one page

> **Print this at A5 and give one to every volunteer.**

### Your screen

- **Left = the queue.** Top of the list is next.
- **Right = the devices.** Colour tells you everything:
  - 🟢 **Green / FREE** → someone should be on it
  - 🔵 **Blue + countdown** → in play, fine
  - 🟡 **Amber** → under 5 minutes left, ask if they want to extend
  - 🔴 **Red, counting up** → **overdue, deal with this first**
  - ⛔ **Grey** → out of service

### Your three jobs

**1. Fill an empty device**
Tap the green card → it shows who's next → tap **START SESSION**. Call the ticket number
out loud twice. Not there? Tap **Not present** and take the next person.

**2. Handle amber**
Walk over. *"Five minutes left — want another 15 for ₹30?"*
Yes → tap **+15**, choose **Collect at reception**, send them to the desk afterwards.
No → let it run out.

**3. Clear red**
Ask them to wrap up, tap **End**, wipe the station down, tap **Ready**.

### Other things

- **Something broken?** Tap the device → **Out of service** → type what's wrong. If
  someone was playing, tell them to go to reception — they get a refund or another turn.
- **Never take money.** All cash goes through reception, always.
- **Never touch admin settings.** If something looks wrong, find the event lead.
- **Banner says "Reconnecting…"?** The buttons will grey out. Wait 30 seconds. Still
  stuck → tell the tech owner and start writing on the paper sheet.
- **End of shift:** Menu → **End shift**, read the summary out to the person taking over.

---

## 4. During the event

### Every 30 minutes — admin

- Glance at the dashboard: is utilisation above 70%? If devices sit green while the
  queue is long, a volunteer isn't filling them — go and talk to them.
- Check the **Dues** count. It should hover near zero.
- Check for any device out of service longer than 15 minutes.

### Every hour — tech owner

- `/actuator/health` still `UP`.
- A fresh backup file exists.
- Disk space on the server laptop.

### Watch for these signals

| Signal | Likely cause | Do this |
|---|---|---|
| Queue growing, devices green | Volunteers not assigning | Go and stand with them for five minutes |
| Many overdue sessions | Volunteers overloaded, or the warning threshold is too short | Add a volunteer; raise the threshold to 8 min in Settings |
| Wait estimates way off | Lots of extensions | Reduce the extension cap in Settings |
| One device type starved | Everyone wants the sim | Make it the priciest plan, or cap sim sessions to 15 min |
| Reception queue longer than the play queue | Registration is the bottleneck | Add a second reception laptop |
| Dues piling up | Volunteers extend but nobody sends students to the desk | Remind volunteers; admin can chase from the Dues tab |

---

## 5. Failure playbook

**Rule of thumb: don't debug in front of a queue.** Switch to paper, restore service,
backfill afterwards.

### 5.1 A volunteer's device won't load the board

1. Check the `[●]` indicator — amber means the server is fine, their Wi-Fi isn't.
2. Reconnect to Wi-Fi. Hard-refresh (`Ctrl/Cmd + Shift + R`).
3. Log out, log back in.
4. Still broken → hand them a spare device, or pair them with another volunteer.
   **One tablet can run the whole floor** — this is inconvenient, not an emergency.

### 5.2 Nobody can reach the app

1. Can the server laptop reach itself at `https://localhost`?
   - **Yes** → it's the network. Check the Ethernet cable, the switch, the Wi-Fi AP.
   - **No** → it's the app. Go to step 2.
2. `docker compose ps` — anything not `Up`?
3. `docker compose logs --tail=100 api`
4. `docker compose restart api` — **~10 seconds, and zero sessions are lost**, because
   all state is in MySQL and every countdown is derived from timestamps.
5. Still down → `docker compose down && docker compose up -d`.
6. Database itself broken → restore the latest dump (§7). **Announce paper fallback
   before you start the restore, not after.**

### 5.3 Power cut

1. UPS holds the server. **Do not panic and do not shut down.**
2. Volunteer devices run on battery; the board keeps working if the Wi-Fi AP is also
   on the UPS (it should be — put it there).
3. If the outage will outlast the UPS: admin does a graceful
   `docker compose stop`, and everyone moves to paper.
4. On power return: `docker compose up -d`, verify health, backfill the paper entries.

### 5.4 Sessions look wrong (a timer is obviously bad)

1. Check the device's clock first — 9 times out of 10 it's client-side skew.
2. Compare against another device's view of the same session.
3. Admin can **force-end** any session with a note and reassign.
4. Ticket numbers and payment rows are never affected by a display bug — the ledger is
   safe.

### 5.5 The cash box doesn't match

1. **Reports → Revenue → by collector.** Filter to the shift in question.
2. Cross-check against **Audit log**, filtered to `PAYMENT_RECORDED`.
3. Common causes, in order of likelihood: a UPI payment recorded as cash, a refund given
   from the box but never recorded, a `WAIVED` ticket where money was actually taken.
4. Record the difference in the closing report with a note. **Don't quietly adjust
   numbers** — the discrepancy is data too.

### 5.6 Escalation

| Severity | Example | Who | Response |
|---|---|---|---|
| **P1** | App down for everyone | Tech owner immediately, paper fallback now | Restore within 15 min |
| **P2** | One role's screen broken | Tech owner | Work around, fix between rushes |
| **P3** | Wrong number in a report | Log it | Fix after the event |

---

## 6. Paper fallback

**Print 20 copies of each. This is the actual disaster plan** — a two-rupee sheet of
paper is more reliable than any amount of clever code.

### Sheet A — Registration log

| # | Time | Name | Phone | Plan | Amount | Cash/UPI | Ticket no. |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Ticket numbers on paper start at **`P-001`** so they can never collide with the app's
`PPX-` sequence when you backfill.

### Sheet B — Device log (one per device)

**Device: `______`**

| Ticket no. | Name | Start | Planned end | Actual end | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Sheet C — Cash tally

| Denomination | Count | Total |
|---|---|---|
| ₹500 / ₹200 / ₹100 / ₹50 / ₹20 / ₹10 | | |
| | **Total counted** | |

### Backfilling afterwards

Enter Sheet A into the app once service is restored — use the ticket **notes** field to
record the original paper number (`P-014`) and the real timestamp. The registration
timestamp will be wrong in the reports, and that is fine: the money and the student list
are what matter, and they'll be correct.

---

## 7. Backup & restore

### Backup — runs automatically every 30 minutes

```bash
./scripts/backup.sh
```

That wraps the dump below, then **checks the file it just wrote**: a dump that died
halfway still leaves a plausible-looking `.sql.gz` behind, so the script refuses to keep
one that is unreadable or missing mysqldump's closing line. It also prunes to the last 48.

```bash
docker compose exec -T db \
  mysqldump -u "$DB_USER" -p"$DB_PASSWORD" \
            --single-transaction --routines --triggers \
            --set-gtid-purged=OFF --no-tablespaces playplex \
  | gzip > "./backups/playplex-$(date +%Y%m%d-%H%M).sql.gz"
```

`--single-transaction` is what makes this safe to run while reception is registering
someone: InnoDB takes a consistent snapshot instead of locking the tables.

Windows Task Scheduler or `cron`, every 30 minutes. Keep the last 48.
**At the end of each day, copy the backups folder to a second machine or a cloud drive.
One copy is not a backup.**

### Restore

```bash
./scripts/restore.sh latest
```

It names the file and its age, makes you type the database name, stops `api` (a restore
under a live connection pool hands Hibernate a schema that changes underneath it), drops
and recreates the schema so the restore *replaces* rather than merges, loads the dump,
then prints the ticket, session and payment counts plus the next ticket number so you can
check them against what you remember before carrying on. The raw sequence:

```bash
docker compose stop api
gunzip -c ./backups/playplex-20260914-1530.sql.gz \
  | docker compose exec -T db mysql -u "$DB_USER" -p"$DB_PASSWORD" playplex
docker compose start api
```

**Test this before the event** (Phase 6, task 6.8). An untested backup is a rumour.

> Restoring into a database that still has data merges rather than replaces. For a clean
> restore, drop and recreate the schema first:
> ```bash
> docker compose exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" \
>   -e "DROP DATABASE playplex; CREATE DATABASE playplex
>       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
> ```
> Rehearse exactly this sequence in Phase 6, on a copy. Under pressure you want muscle
> memory, not a decision.

---

## 8. Closing checklist

### Volunteers

| ✓ | Step |
|---|---|
| ☐ | End every running session |
| ☐ | Send anyone with dues to reception **before they leave** |
| ☐ | Mark broken devices `OUT_OF_SERVICE` with a clear reason for tomorrow |
| ☐ | Stations wiped, controllers on charge, peripherals accounted for |
| ☐ | End shift on the app |

### Reception

| ✓ | Step |
|---|---|
| ☐ | Dues tab is **empty** — collected or written off with a reason |
| ☐ | Cash counted using Sheet C |
| ☐ | UPI app total noted |

### Admin

| ✓ | Step |
|---|---|
| ☐ | **Reports → Summary**, print or screenshot it |
| ☐ | Reconcile: opening float + cash collected − refunds = counted cash |
| ☐ | Reconcile the UPI total against the report |
| ☐ | Note any difference **with an explanation**, don't just adjust |
| ☐ | Export all four CSVs |
| ☐ | Confirm today's final backup exists and is copied off the machine |
| ☐ | Note tomorrow's fixes: devices to repair, prices to adjust, staffing to change |

### Tech owner

| ✓ | Step |
|---|---|
| ☐ | Final `mysqldump`, copied to a second location |
| ☐ | Scan `docker compose logs api` for errors worth fixing overnight |
| ☐ | Leave the stack **running** (it restarts clean tomorrow) or stop it cleanly |
| ☐ | Server laptop left plugged in and charging |

---

## 9. After the event

| ✓ | Step |
|---|---|
| ☐ | Restore the final dump into the cloud instance — it becomes the permanent archive |
| ☐ | Produce the committee report: total revenue, registrations, utilisation, peak hours, most popular device |
| ☐ | Run the **anonymisation script** — clears phone numbers and roll numbers, keeps the stats |
| ☐ | Retro with the volunteer team: what was confusing, what was missing, what they invented a workaround for |
| ☐ | Write the retro notes into `/docs` while it's fresh — that's what makes next year's build a week instead of a month |
| ☐ | Tag the release in git so next year starts from a known-good state |

---

## 10. Emergency contacts

Fill this in and print it. It's the one part of this document nobody can improvise.

| Role | Name | Phone |
|---|---|---|
| Event lead | | |
| Tech owner | | |
| Backup tech | | |
| Venue / facilities | | |
| College IT (network) | | |
| Electrical / maintenance | | |

---

## 11. Deploying the stack

Do this the week before, not the morning of. The whole event runs from one
`docker-compose.yml`: MySQL, the API, and nginx serving the UI. It works the same on Linux
and on Docker Desktop for Windows. The differences between the two are listed below the
common steps.

### Common to both

```bash
git clone <repo> playplex && cd playplex
cp .env.example .env
```

Edit `.env` before the first start:

- **`JWT_SECRET`**: generate a real one with `openssl rand -base64 48`. The default is the
  development secret from `application.yml`, and anyone who has read this repo can forge a
  sign-in with it.
- **`DB_PASSWORD`** and **`DB_ROOT_PASSWORD`**: change both. They are baked into the MySQL
  volume on first start, and changing them later means recreating it.
- **`WEB_PORT`**: leave it at `80` unless `up` fails to bind it (see below).

```bash
docker compose up -d
docker compose ps           # db, api and web all "healthy" after about a minute
```

Open `http://<laptop-ip>/` from a staff device and sign in as **`admin` / `playplex`**. The
system requires a new password before anything else works. Then create the real staff
accounts from the **Staff** screen.

Use `docker compose` (the v2 plugin), not the old `docker-compose`.

### Linux

- **Port 80** needs root. With rootless Docker, or a host that refuses it, set
  `WEB_PORT=8080` in `.env` and give out `http://<laptop-ip>:8080/` instead.
- **SELinux (Fedora, RHEL, Rocky, Alma)** blocks the `./backups` bind mount unless it is
  relabelled, and the failure is quiet: the backups simply never appear. Run this once, then
  take a test backup and check the file exists:
  ```bash
  sudo chcon -Rt svirt_sandbox_file_t ./backups
  ```
- Make sure `docker` starts at boot (`sudo systemctl enable docker`). With that and
  `restart: unless-stopped`, a reboot mid-event brings the whole stack back with nobody
  signed in.
- Schedule the backup with cron, every 30 minutes (§7):
  ```bash
  */30 * * * * cd /path/to/playplex && ./scripts/backup.sh >> backups/backup.log 2>&1
  ```

### Windows (Docker Desktop)

- **Docker Desktop has to start by itself.** On Windows the Docker engine is a desktop app,
  not a boot service, so `restart: unless-stopped` only helps once someone is signed in and
  Docker Desktop has started. Turn on *Settings → General → Start Docker Desktop when you
  sign in*, and either set the laptop to sign in automatically or make sure the tech owner
  can type the password within a minute. **This is the biggest difference from Linux. If
  you skip it, a mid-event reboot brings nothing back, and every board drops to the
  paper-fallback screen.**
- **Port 80** is often already taken by IIS or HTTP.sys; it shows up as the `System`
  process. If `up` reports it cannot bind, set `WEB_PORT=8080`.
- **The scripts are bash.** Run `backup.sh` and `restore.sh` from Git Bash, which comes with
  Git for Windows, or from WSL. For the 30-minute backup, Task Scheduler must call bash
  directly:
  ```
  "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/path/to/playplex && ./scripts/backup.sh"
  ```
- Use `mvnw.cmd` rather than `./mvnw` if you ever build the backend outside Docker. Docker
  itself does not need it.

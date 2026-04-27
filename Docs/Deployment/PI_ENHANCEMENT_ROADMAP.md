# Pi / Ubuntu Enhancement Roadmap

Step-by-step plan to enhance the Raspberry Pi production server with performance,
reliability, security, and feature improvements. Each step is independently deployable
and verifiable before moving on to the next.

---

## Progress tracker

| # | Step | Category | Status | Verify |
|---|---|---|---|---|
| 1 | System packages (libreoffice-impress, fonts, poppler, zip) | System | ✅ Done | PPTX/PDF thumbnails work |
| 2 | BullMQ Phase 1 — queue/worker scaffolding | Performance | ✅ Done | API boots, Redis OK in health |
| 3 | BullMQ Phase 2 — media processing async | Performance | ✅ Done | Upload returns <1s; thumbnail appears via React Query refetch |
| 4 | Redis + Node heap tuning | Performance | ✅ Done | `infra/pi/tune-redis-postgres.sh` |
| 5 | Security C8 — ZIP upload validation | Security | ✅ Done | `apps/api/src/services/zip-validation.ts` |
| 6 | HTML5 editor backend — file CRUD routes | Feature | ✅ Done | `/content/:id/html5/files` etc. |
| 7 | HTML5 editor frontend — Monaco modal + file tree | Feature | ✅ Done | `apps/ds/src/components/Html5EditorModal.tsx` |
| 8 | HTML5 templates — 5 starter templates | Feature | ✅ Done | UploadModal "Template" tab + `services/html5-templates.ts` |
| 9 | Playwright thumbnails for HTML5 content | Feature | ✅ Done | Optional dynamic import + Pi install script |
| 10 | BullMQ Phase 3 — webhook delivery queue | Reliability | ✅ Done | `dispatchWebhookEvent` enqueues; setInterval kept as fallback |
| 11 | BullMQ Phase 4 — recurring jobs as BullMQ repeatables | Reliability | ✅ Done | `apps/api/src/workers/recurring.ts` |
| 12 | Security C7 — sandbox iframe in HTML5 preview | Security | ✅ Done | `sandbox="allow-scripts"` only (no `allow-same-origin`) |
| 13 | UFW firewall + bind localhost for Postgres/Redis | Security | ✅ Done | `infra/pi/setup-ufw.sh` |
| 14 | fail2ban — superadmin auth log monitoring | Security | ✅ Done | `infra/pi/setup-fail2ban.sh` |
| 15 | Per-account login lockout (Redis-backed) | Security | ✅ Done | `apps/api/src/services/login-lockout.ts` |

---

## Step 1 — System packages ✅ Done

**Files changed:**
- `infra/pi/bootstrap.sh` — replaced `libreoffice-common` with full packages
- `infra/pi/install-system-packages.sh` — new idempotent upgrade script

**What changed and why:**

| Old package | New packages | Reason |
|---|---|---|
| `libreoffice-common` | `libreoffice-impress` + `libreoffice-writer` | `common` is only shared icon assets — can't actually convert files. PPTX thumbnail generation silently failed without the real binaries. |
| *(missing)* | `fonts-liberation` | Arial / Times New Roman / Courier equivalents. Without these, LibreOffice renders PPTX slides with wrong font metrics, broken layouts. |
| *(missing)* | `fonts-noto-core` | Unicode coverage for slides with non-Latin characters (CJK, Arabic, etc.) |
| *(missing)* | `poppler-utils` | Adds `pdftoppm` and `pdfinfo` — better PDF tools alongside Ghostscript |
| *(missing)* | `zip` + `unzip` | Required for HTML5 editor (Step 6) — ZIP repacking server-side |

**What else was fixed in `routes/content.ts`:**
- Upload handler previously only generated thumbnails for `image` and `video`
- Now generates thumbnails for `pdf` (Ghostscript at 150 DPI + sharp resize) and `presentation` (LibreOffice → sharp resize) too
- Regenerate-thumbnail route now uses the same shared helpers instead of duplicated inline code
- Old Ghostscript call used 72 DPI (too low for clear thumbnails); fixed to 150 DPI

**To apply on the existing Pi (already bootstrapped):**
```bash
ssh chiho@192.168.1.17
cd /opt/signage && git pull
sudo bash infra/pi/install-system-packages.sh
sudo systemctl restart signage-api
```

**Verify:**
```bash
# On Pi — confirm soffice is real now
soffice --version

# Dashboard — upload a .pptx file → thumbnail should appear
# Dashboard — use "Regenerate thumbnail" on existing PDF
```

---

## Step 2 — BullMQ Phase 1: Queue / Worker scaffolding

**Risk:** Very low — no behavior change. Workers only start if Redis is connected.

**What it does:**
- Creates `apps/api/src/queues/index.ts` — shared queue factory using `getRedis()` singleton
- Creates `apps/api/src/workers/index.ts` — `startWorkers()` function; guards on Redis availability
- Wires `startWorkers()` into `apps/api/src/index.ts` alongside `startJobs()`
- If `REDIS_URL` is not set or Redis is unreachable → workers never start, everything runs as before

**Files to create/modify:**
- `apps/api/src/queues/index.ts` (new)
- `apps/api/src/workers/index.ts` (new)
- `apps/api/src/index.ts` (add `startWorkers()` call)

**Verify:**
```bash
# After deploy — API should still boot and health endpoint should show Redis OK
curl http://127.0.0.1:3000/api/v1/health
# Superadmin system page should show Redis latency
```

---

## Step 3 — BullMQ Phase 2: Media processing async

**Risk:** Medium — changes upload response behavior. Has Redis-null fallback (runs inline as before).

**What it does:**
- Creates `apps/api/src/workers/media-processing.ts`
  - Worker with `concurrency: 2` (leaves 2 Pi cores for API + OS)
  - `removeOnComplete: { count: 500 }`, `removeOnFail: { count: 200 }`
  - Handles all types: image (sharp), video (ffmpeg), pdf (ghostscript), presentation (soffice)
- Modifies upload handler (`routes/content.ts`):
  - File is saved to disk, hashed, duplicate-checked, DB row inserted with `status: 'processing'`
  - Job enqueued: `{ contentId, filePath, type }`
  - HTTP response returns 201 **immediately** (no waiting for ffmpeg/sharp)
  - Worker updates DB: `thumbnailPath`, `width`, `height`, `duration`, `metadata`, `status: 'ready'`
  - Worker sends WebSocket notification so dashboard updates live

**Fallback:** if `getRedis()` returns null → inline processing runs as today (no `status: 'processing'`, immediate `status: 'ready'`)

**Pi impact:**
- 100MB video upload: was ~15–30s HTTP wait → becomes <1s response

**Verify:**
1. Upload a large video → response should return in under 1 second
2. Dashboard content list shows item with "processing" indicator
3. Thumbnail appears a few seconds later (WS push updates the UI without refresh)
4. Check Redis queue depth: `redis-cli -a 'PASSWORD' llen bull:media-processing:wait`

---

## Step 4 — Redis + Node heap tuning

**Risk:** Low — config-only changes.

### 4.1 Redis memory policy

On the Pi, edit `/etc/redis/redis.conf`:
```
maxmemory 128mb
maxmemory-policy noeviction
```

`noeviction` is critical for BullMQ — if Redis runs out of memory it must return an error
rather than silently evicting job data.

```bash
sudo nano /etc/redis/redis.conf
# Add/update the two lines above
sudo systemctl restart redis-server
redis-cli -a 'RedisSignage@2026!' CONFIG GET maxmemory-policy
# Expected: maxmemory-policy → noeviction
```

### 4.2 Node.js heap cap

In `/etc/signage/api.env`, add:
```dotenv
NODE_OPTIONS=--max-old-space-size=512
```

Pi 5 has 4–8 GB RAM but ffmpeg child processes, Postgres, and Redis all need headroom.
Capping Node at 512 MB prevents the API process from accidentally consuming all available RAM
during heavy media processing.

```bash
sudo nano /etc/signage/api.env
sudo systemctl restart signage-api
```

### 4.3 Postgres connection tuning (optional but recommended)

On the Pi, edit `/etc/postgresql/*/main/postgresql.conf`:
```
max_connections = 30        # down from default 100 — Pi RAM savings
shared_buffers = 256MB      # 25% of 1 GB reserved for Postgres
work_mem = 8MB
maintenance_work_mem = 64MB
```

```bash
sudo nano /etc/postgresql/17/main/postgresql.conf
sudo systemctl restart postgresql
```

**Verify:** `redis-cli -a 'PASSWORD' INFO memory` — check `used_memory_human` and `maxmemory_policy`.

---

## Step 5 — Security C8: ZIP upload validation

**Risk:** Low — adds rejection rules before any file is written to disk.

**What it does (in `routes/content.ts` upload handler, before file streaming):**
- Reject if any file path inside the ZIP contains `..` (zip-slip attack)
- Reject if any path is absolute (e.g. `/etc/passwd`)
- Reject if total uncompressed size > 100 MB (zip-bomb prevention)
- Reject if file count > 1,000

Uses the existing `adm-zip` package — no new dependencies.

**Verify:**
```bash
# Create a malicious ZIP with path traversal
python3 -c "
import zipfile, io
b = io.BytesIO()
with zipfile.ZipFile(b, 'w') as z:
    z.writestr('../../../etc/passwd', 'test')
open('evil.zip','wb').write(b.getvalue())
"
# Upload evil.zip to /content/upload → should get 400 error
```

---

## Step 6 — HTML5 editor backend: File CRUD routes

**Risk:** Medium — new routes, no existing route changes.

**New routes in `routes/content.ts`:**

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/content/:id/html5/files` | List all files in the ZIP (path, size, isText) |
| `GET` | `/content/:id/html5/file?path=` | Return file contents as UTF-8 text |
| `PUT` | `/content/:id/html5/file` | `{ path, content }` → update file in ZIP, re-save to disk |
| `POST` | `/content/:id/html5/file` | `{ path, content }` → add new file to ZIP |
| `DELETE` | `/content/:id/html5/file?path=` | Remove file from ZIP |
| `POST` | `/content/:id/html5/rename-file` | `{ from, to }` → rename/move file inside ZIP |

All routes: `onRequest: [app.authenticate]` + workspace access check.

After any write: invalidates the extracted cache at `os.tmpdir()/nexari-html5/:id/` so the
device serving route re-extracts the updated ZIP on next request.

**Verify:**
```bash
# List files in uploaded HTML5 ZIP
curl -H "Cookie: access_token=..." \
  http://localhost:3000/api/v1/content/CONTENT_ID/html5/files

# Edit index.html
curl -X PUT -H "Cookie: ..." -H "Content-Type: application/json" \
  -d '{"path":"index.html","content":"<html><body>Hello</body></html>"}' \
  http://localhost:3000/api/v1/content/CONTENT_ID/html5/file
```

---

## Step 7 — HTML5 editor frontend: Monaco modal + file tree

**Risk:** Medium — new component; `ContentDetailPanel.tsx` gets an "Edit" button for html5 type.

**npm package to add:**
```bash
pnpm --filter @signage/ds add @monaco-editor/react
```
Monaco is ~4 MB and **lazy-loads** — only bundled when the editor modal opens. No impact on initial dashboard load.

**New component:** `apps/ds/src/components/Html5EditorModal.tsx`

```
┌─────────────────────────────────────────────────────┐
│  [← back]   my-banner.zip   [Preview] [Save] [✕]   │
├──────────────┬──────────────────────────────────────┤
│  File tree   │  Monaco Editor                       │
│  ──────────  │  (language auto-detected from ext)   │
│  index.html  │                                      │
│  style.css   │  <html>                              │
│  app.js      │    <body>…                           │
│  ▶ assets/   │                                      │
│    logo.png  │                                      │
│  [+ New file]│                                      │
└──────────────┴──────────────────────────────────────┘
```

- Dirty state tracking per file (unsaved badge)
- **Preview button** → opens sandboxed iframe at the device content URL (no new backend needed)
- Save → calls `PUT /content/:id/html5/file` for each dirty file → triggers thumbnail regeneration

**Files to modify:**
- `apps/ds/src/components/ContentDetailPanel.tsx` — add "Edit" button when `item.type === 'html5'`
- `apps/ds/src/pages/workspace/ContentPage.tsx` — wire edit modal state

---

## Step 8 — HTML5 templates: 5 starter templates

**Risk:** Low — new endpoint + UI tab, nothing existing is changed.

**New backend route:** `POST /content/html5/create`
- Accepts `{ workspaceId, templateId, name }`
- Generates a ZIP from a server-side template
- Inserts DB row, returns item (editor opens immediately)

**Templates (basic → complex):**

| # | ID | Description |
|---|---|---|
| 1 | `blank` | `index.html` + `style.css` — empty canvas |
| 2 | `scrolling-text` | Animated CSS marquee with editable message |
| 3 | `image-caption` | Full-width image with overlaid text caption |
| 4 | `countdown-timer` | JavaScript countdown to a configurable target date |
| 5 | `multi-zone-rotate` | CSS grid with 3 zones; each auto-rotates through a list of items |

**Frontend:** "Create HTML5" tab added to `UploadModal.tsx` — shows template cards, name input, "Create & Edit" button.

---

## Step 9 — Playwright thumbnails for HTML5 content

**Risk:** Medium — new system dependency (chromium), new worker branch.

### 9.1 Install on Pi

```bash
sudo apt-get install -y --no-install-recommends chromium-browser
# Install Playwright Node package
pnpm --filter @signage/api add playwright
npx playwright install chromium --with-deps
```

Add to `infra/pi/install-system-packages.sh` for future runs.

### 9.2 Code changes

In `apps/api/src/workers/media-processing.ts` (from Step 3), add an `html5` branch:
1. Extract the HTML5 ZIP to a temp dir (if not already cached)
2. Launch headless Chromium via Playwright
3. Navigate to `file:///.../index.html`
4. Wait 2 seconds for JavaScript to settle
5. Capture screenshot → resize to 400×225 JPEG via sharp
6. Update DB `thumbnailPath`, broadcast WS event

**Verify:**
1. Upload a new HTML5 ZIP
2. Wait a few seconds
3. Content thumbnail appears in dashboard without manual intervention

---

## Step 10 — BullMQ Phase 3: Webhook delivery queue

**Risk:** Low — replaces custom setInterval/backoff with BullMQ; same external behavior.

**What changes:**
- `dispatchWebhookEvent()` in `services/webhooks.ts` enqueues one BullMQ job per delivery record
- New worker `apps/api/src/workers/webhook-delivery.ts` with `concurrency: 5` (IO-bound)
- BullMQ handles retry + exponential backoff natively (removes ~50 lines of custom backoff math)
- DB `webhook_deliveries` table still written for audit history
- 30-second `setInterval` for `webhook-delivery` removed from `services/jobs.ts`
- **Fallback:** if Redis null → setInterval path kept

**BullMQ retry config:**
```typescript
attempts: 5,
backoff: { type: 'exponential', delay: 30_000 }
// Produces: 30s, 60s, 120s, 240s, 480s
```

**Verify:**
- Configure a webhook pointing to a non-existent URL
- Trigger an event (e.g. device goes offline)
- Check `webhook_deliveries` table — should see 5 attempts over increasing intervals

---

## Step 11 — BullMQ Phase 4: Recurring jobs as BullMQ repeatables

**Risk:** Low — same job logic, different scheduler. Survives API restarts.

**Jobs migrated from `setInterval` to BullMQ repeatable:**

| Job | Current interval | BullMQ cron |
|---|---|---|
| `file-cleanup` | 1 hour | `0 * * * *` |
| `content-expiry` | 5 min | `*/5 * * * *` |
| `heartbeat-cleanup` | 24 hours | `0 3 * * *` (3 AM) |
| `play-events-partition` | 24 hours | `0 2 * * *` (2 AM) |
| `sensor-reading-cleanup` | 24 hours | `0 4 * * *` (4 AM) |
| `webhook-delivery-cleanup` | 24 hours | `0 5 * * *` (5 AM) |

**Benefit:** If the API restarts at 2:59 AM, the partition job still runs at 3:00 AM because
the schedule is stored in Redis, not in process memory.

**Verify:**
```bash
# After deploy, check repeatable jobs are registered
redis-cli -a 'PASSWORD' KEYS 'bull:*repeat*'
# /health/jobs endpoint should still show all job names and last run times
```

---

## Step 12 — Security C7: Sandbox iframe in HTML5 preview

**Risk:** Low — one attribute added to the preview iframe.

**What it does:**
In `Html5EditorModal.tsx` (from Step 7), the preview iframe gets:
```html
<iframe
  src="..."
  sandbox="allow-scripts allow-same-origin"
  referrerpolicy="no-referrer"
/>
```

This prevents a malicious uploaded HTML5 package from:
- Navigating the parent window (`allow-top-navigation` not granted)
- Submitting forms to external sites (`allow-forms` not granted)
- Accessing dashboard cookies from a different origin context

**Note:** `allow-same-origin` is needed so relative asset requests (scripts, images) within
the HTML5 package work correctly. The device serving route already embeds the auth token
in the URL path so no cookie access is required.

---

## Step 13 — UFW firewall + bind localhost

**Risk:** Low — test on Pi before relying on it. Do NOT lock yourself out of SSH.

### 13.1 UFW rules

```bash
sudo apt-get install -y ufw

# Default: deny all inbound, allow all outbound
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH — restrict to LAN only (prevents internet SSH brute force)
sudo ufw allow from 192.168.0.0/16 to any port 22

# HTTP + HTTPS (public — nginx terminates, never exposes Fastify directly)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable (verify SSH rule is in place BEFORE this)
sudo ufw enable
sudo ufw status verbose
```

### 13.2 Bind Postgres and Redis to localhost

These should already be bound to localhost from the Redis setup in Section 6 of PI_DEPLOYMENT.md.
Verify and enforce:

```bash
# Redis — should already show: bind 127.0.0.1 -::1
grep '^bind' /etc/redis/redis.conf

# Postgres
sudo -u postgres psql -c "SHOW listen_addresses;"
# If not 'localhost' or '127.0.0.1':
sudo nano /etc/postgresql/17/main/postgresql.conf
# Set: listen_addresses = 'localhost'
sudo systemctl restart postgresql
```

**Verify from another machine on the LAN:**
```bash
# These should all TIME OUT or CONNECTION REFUSED
nc -zv 192.168.1.17 5432
nc -zv 192.168.1.17 6379
nc -zv 192.168.1.17 3000
```

---

## Step 14 — fail2ban: superadmin auth monitoring

**Risk:** Low.

```bash
sudo apt-get install -y fail2ban
```

**Create jail config** at `infra/pi/fail2ban-signage.conf` (copied to Pi during deploy):
```ini
[signage-superadmin]
enabled  = true
port     = http,https
filter   = signage-superadmin
logpath  = /var/log/nginx/access.log
maxretry = 5
findtime = 60
bantime  = 600
```

**Create filter** at `/etc/fail2ban/filter.d/signage-superadmin.conf`:
```
[Definition]
failregex = ^<HOST> .* "POST /api/v1/superadmin/auth/login HTTP.*" 401
ignoreregex =
```

```bash
sudo cp infra/pi/fail2ban-signage.conf /etc/fail2ban/jail.d/signage-superadmin.conf
sudo systemctl restart fail2ban
sudo fail2ban-client status signage-superadmin
```

**Verify:**
```bash
# Attempt 6 failed superadmin logins from one IP
# After 5th: check banned IPs
sudo fail2ban-client status signage-superadmin
# Should show: Banned IP list: <your IP>
```

---

## Step 15 — Per-account login lockout (Redis-backed)

**Risk:** Low — uses existing `getRedis()` service. Fail-open: if Redis is down, lockout is skipped.

**What it does (in `routes/auth.ts`):**
- On failed `POST /auth/login`: increment Redis key `login-fail:<email-hash>` (TTL 15 min)
- After 10 failures: return generic 401 with no specific error (same as wrong password)
- On successful login: delete the Redis key
- Writes `LOGIN_LOCKOUT` event to audit log when threshold is crossed

**Why email hash not plaintext:** avoids storing raw PII in Redis. Uses SHA-256 truncated to 32 chars.

**This is distinct from fail2ban:** fail2ban bans by IP; this locks by account identity. Together they cover both IP rotation attacks and credential stuffing against a single account from many IPs.

**Verify:**
```bash
# Make 11 failed login attempts with the same email
# 11th attempt should return 401 with same message as wrong password
# Check audit_log table: action = 'LOGIN_LOCKOUT'
# Wait 15 minutes (or manually delete the Redis key)
# Successful login should work again
```

---

## Future steps (not scheduled yet)

These are identified but deliberately deferred until the above 15 steps are stable:

| Item | Description |
|---|---|
| BullMQ Phase 5 | IoT sensor trigger queue — dequeue sensor readings for rule evaluation |
| Security C3 | JWT secret rotation with `JWT_SECRET_PREVIOUS` fallback |
| Security C5 | Refresh token reuse detection — revoke full chain on replay |
| Security C6 | Strict Content Security Policy headers for dashboard routes |
| Security C9 | Audit log immutability via Postgres trigger |
| Security C11 | HSTS strict-transport header |
| Security C12 | Automated encrypted database backups |
| Security C13 | `pnpm audit` in deploy pipeline |
| Security C14 | Login notification emails for new IP/UA |
| Security C15 | WebSocket re-authentication on token expiry |
| ffmpeg hwaccel | `-hwaccel v4l2m2m` opt-in for Pi 5 video thumbnail generation |
| Device token rotation | 30-day auto-rotation of Tizen device tokens |
| 2FA enforcement | Mandatory TOTP for `platform_owner` and `management_company_admin` roles |

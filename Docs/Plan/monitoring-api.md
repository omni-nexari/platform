# Monitoring API Reference
# Orange Pi 5 — 192.168.1.17
# Last updated: 2026-05-07

## Authentication
All endpoints on port 8080 require HTTP Basic Auth.

```
Username: admin
Password: Scatter@2026!
```

Example header:
```
Authorization: Basic <base64 of admin:Scatter@2026!>
```

---

## 1. Netdata — System & Service Metrics

Base URL: `http://192.168.1.17:8080`

Netdata runs on `127.0.0.1:19999` internally and is proxied through nginx on port 8080.

### List all available charts
```
GET /api/v1/charts
```
Returns JSON with all chart IDs. Use this to discover available metrics.

### Get metric data
```
GET /api/v1/data?chart=<chart_id>&after=<seconds>&points=<n>&format=json
```

| Param | Description |
|---|---|
| `chart` | Chart ID (see below) |
| `after` | Negative = relative seconds from now (e.g. `-300` = last 5 min) |
| `points` | Number of data points to return |
| `format` | `json` or `jsonp` |

#### Key chart IDs

| Chart ID | What it shows |
|---|---|
| `nginx_local.connections_state` | Active / reading / writing / waiting connections |
| `nginx_local.requests_total` | Total requests/sec |
| `system.cpu` | CPU usage % per core |
| `system.ram` | RAM used / free / cached |
| `system.net` | Network in/out bytes/sec (all interfaces) |
| `net.eth0` | eth0 specific in/out |
| `system.io` | Disk read/write |
| `disk_space._` | Root disk usage |
| `systemd.service_unit_state` | State of all systemd services (1 = active) |
| `postgres_local.connections` | DB connection count |
| `postgres_local.queries` | Query rate |
| `postgres_local.db_size` | Database sizes |
| `postgres_local.locks` | Lock count per DB |
| `redis_local.clients` | Connected Redis clients |
| `redis_local.commands` | Redis ops/sec |
| `redis_local.mem` | Redis memory usage |
| `redis_local.keys` | Key count per database |
| `mqtt_local.clients_connected` | Mosquitto connected clients |
| `mqtt_local.messages_received` | MQTT messages received/sec |
| `mqtt_local.messages_sent` | MQTT messages sent/sec |
| `mqtt_local.subscriptions_count` | Active subscriptions |
| `mqtt_local.bytes_received` | MQTT bytes in/sec |
| `mqtt_local.bytes_sent` | MQTT bytes out/sec |

#### Example: CPU last 5 minutes
```
GET /api/v1/data?chart=system.cpu&after=-300&points=60&format=json
```

#### Example: signage-api service state
```
GET /api/v1/data?chart=systemd.service_unit_state&after=-60&points=1&format=json
```

### Get all active alarms
```
GET /api/v1/alarms
```

### Netdata server info
```
GET /api/v1/info
```

---

## 2. GoAccess — HTTP Traffic Analytics

### Live HTML dashboard
```
GET http://192.168.1.17:8080/traffic/
```
Browser-based real-time report (auto-updates via WebSocket).

### JSON snapshot (polling, updated every 5 minutes)
```
GET http://192.168.1.17:8080/traffic/report.json
```
Returns full GoAccess JSON report including:
- `visitors` — unique IPs
- `requests` — top endpoints by hit count + bandwidth
- `not_found` — 404 URLs
- `status_codes` — breakdown of 2xx / 4xx / 5xx
- `avg_time` — average response time (from `rt=` in logs)
- `os`, `browsers`, `geolocation`

### WebSocket live stream
```
ws://192.168.1.17:7890
```
Receives the same JSON structure as the HTML report, pushed on every log line.
Connect and parse `JSON.parse(event.data)` to get live updates.

---

## 3. MQTT Broker — Mosquitto

Two listeners are active:

| Listener | Address | Protocol | Use |
|---|---|---|---|
| MQTTS | `0.0.0.0:8883` | MQTT over TLS | Internet + LAN devices |
| MQTT | `192.168.1.17:1883` | Plain MQTT | LAN only |

Authentication: **username + password required** on both ports. Anonymous connections are rejected.

### Connection strings

```
# From internet or external devices
mqtts://ds.chiho.app:8883

# From LAN devices
mqtt://192.168.1.17:1883
```

No custom CA needed for MQTTS — cert is Let's Encrypt (trusted by all OS/runtimes).

### Managing users

```bash
# Add a user
sudo mosquitto_passwd -b /etc/mosquitto/passwd <username> <password>

# Delete a user
sudo mosquitto_passwd -D /etc/mosquitto/passwd <username>

# Reload (no restart needed)
sudo systemctl reload mosquitto
```

### Cert renewal
Certbot deploy hook at `/etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh` automatically copies renewed certs to `/etc/mosquitto/certs/` and reloads the broker.

### Current users
| Username | Purpose |
|---|---|
| `test` | Test user — replace with real per-device users |

---

## 4. CrowdSec — Threat Intelligence & Decisions

CrowdSec LAPI runs on `127.0.0.1:8090` (not exposed via nginx — query from server or add a proxy).

### API Key
```
X-Api-Key: dashboard-ro-key
```

### Get active ban decisions
```
GET http://127.0.0.1:8090/v1/decisions
X-Api-Key: dashboard-ro-key
```
Returns array of active bans (IP, reason, duration).

### Get decisions by IP
```
GET http://127.0.0.1:8090/v1/decisions?ip=<ip_address>
X-Api-Key: dashboard-ro-key
```

### Get CrowdSec metrics
```
GET http://127.0.0.1:8090/v1/metrics
X-Api-Key: dashboard-ro-key
```

> To expose CrowdSec API externally, add an nginx proxy block to monitoring.conf with auth.

CrowdSec monitors these log sources: nginx access/error, auth.log, syslog, PostgreSQL, **Mosquitto** (`/var/log/mosquitto/mosquitto.log`).

---

## 5. SSL Certificate Status

### Days remaining (plain text integer)
```
GET http://192.168.1.17:8080/ssl-status
Authorization: Basic <token>
```
Returns a single integer — number of days until `ds.chiho.app` cert expires.

- Updated daily at 07:00 by `/usr/local/bin/check-ssl-expiry.sh`
- If < 21 days: script auto-triggers `certbot renew`

---

## 6. PostgreSQL Backup Status

### Last backup result (plain text)
```
GET http://192.168.1.17:8080/backup-status
Authorization: Basic <token>
```
Returns one line:
```
2026-05-07T10:22:35+08:00 OK 1.9M all-2026-05-07_1022.sql.gz
```

- Updated daily at 02:00
- Backups stored at `/var/backups/postgres/` — 14-day retention
- Backup runs 1 hour before auto-reboot window (03:00)

---

## 7. Quick Reference — All Endpoints

| Endpoint | Auth | Returns |
|---|---|---|
| `GET :8080/api/v1/charts` | Basic | All Netdata chart IDs |
| `GET :8080/api/v1/data?chart=<id>&after=-300` | Basic | Time-series metric data |
| `GET :8080/api/v1/alarms` | Basic | Active Netdata alarms |
| `GET :8080/api/v1/info` | Basic | Netdata server info |
| `GET :8080/traffic/` | Basic | GoAccess live HTML |
| `GET :8080/traffic/report.json` | Basic | GoAccess JSON snapshot |
| `ws://192.168.1.17:7890` | None | GoAccess live WebSocket |
| `GET :8090/v1/decisions` | API Key | CrowdSec active bans |
| `GET :8080/ssl-status` | Basic | SSL cert days remaining |
| `GET :8080/backup-status` | Basic | Last PG backup status |
| `mqtts://ds.chiho.app:8883` | user+pass | MQTTS (internet + LAN) |
| `mqtt://192.168.1.17:1883` | user+pass | Plain MQTT (LAN only) |
| `ws://192.168.1.17:7890` | None | GoAccess live WebSocket |

---

## Scheduled Jobs Summary

| Job | Schedule | What |
|---|---|---|
| SSL expiry check | Daily 07:00 | Check cert + auto-renew if < 21 days |
| PG backup | Daily 02:00 | Full pg_dumpall, 14-day retention |
| GoAccess JSON | Every 5 min | Refresh `/traffic/report.json` |
| Lynis audit | Weekly | Security audit → `/var/log/lynis/` |
| Unattended upgrades | Daily | Security patches, reboot at 03:00 if needed |
| Mosquitto cert copy | On cert renewal | Certbot hook copies certs + reloads broker |

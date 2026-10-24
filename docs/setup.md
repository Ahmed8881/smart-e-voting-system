# Setup guide

The short version is in the root [README](../README.md). This page covers the details, the
configuration, a full demo walkthrough, and troubleshooting.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.9 or newer | backend + frontend |
| Python | 3.12 | AI service |
| MySQL | 8.x | Docker Desktop, or a local install (below) |
| git | any | |
| A webcam | — | registration and sign-in need a live face |
| A phone/laptop with fingerprint, Face ID or a screen lock | — | WebAuthn device step |

## 2. Configuration (`.env` in the repository root)

`cp .env.example .env`, then replace every `CHANGE_ME`. One file serves the backend, the AI
service and Docker Compose.

| Variable | Purpose |
|---|---|
| `MYSQL_*`, `DATABASE_URL`, `TEST_DATABASE_URL` | database credentials; the test database is wiped by the tests, so its name must contain `test` |
| `JWT_ACCESS_SECRET` | 32+ random characters, signs access and face-step tokens |
| `REFRESH_TOKEN_TTL_DAYS` | refresh cookie lifetime (default 7) |
| `CORS_ORIGIN` | exact frontend origin |
| `ADMIN_SEED_*` | the first admin, created by `npm run db:seed` (password 12+ characters) |
| `SMTP_URL`, `MAIL_FROM` | admin login codes; empty in development = written to `backend/.dev-mail/` |
| `AI_SERVICE_URL`, `AI_SERVICE_TOKEN` | backend → AI service; the token is a shared secret, 32+ characters |
| `FACE_ENCRYPTION_KEY` | 32 random bytes, base64. **Losing it makes every enrolled face unusable** |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS` | the site's domain and origin(s) for device credentials |
| `TRUST_PROXY` | which proxies may set the client IP (`loopback` for the Vite proxy) |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT / service token
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # FACE_ENCRYPTION_KEY
```

## 3. Database

**Docker:** `docker compose up -d`. The init script creates the `evoting_test` database and the
grants `prisma migrate dev` needs.

**Without Docker (Windows, no admin rights):** download the MySQL 8.4 "ZIP Archive" from
dev.mysql.com, extract it, for example to `%LOCALAPPDATA%\evoting-mysql\server`, and create
`my.ini` next to it:

```ini
[mysqld]
basedir=C:/Users/<you>/AppData/Local/evoting-mysql/server
datadir=C:/Users/<you>/AppData/Local/evoting-mysql/data
port=3306
bind-address=127.0.0.1
```

Then initialise once with `mysqld --defaults-file=my.ini --initialize-insecure`, start it with
`mysqld --defaults-file=my.ini`, set a root password, and run the SQL from the README (databases,
user, grants).

Apply the schema and create the first admin:

```bash
cd backend
npm install           # also generates the Prisma client
npm run db:deploy     # apply migrations (use npm run db:migrate when changing the schema)
npm run db:seed
```

## 4. AI service

```bash
cd ai-service
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python scripts/download_models.py                   # YuNet, SFace, MediaPipe (~43 MB, checksummed)
python scripts/generate_synthetic.py                # fraud anomaly model (synthetic data)
uvicorn app.main:app --env-file ../.env --port 8001
```

## 5. Run

Three terminals: `backend` → `npm run dev`; `ai-service` → the uvicorn command above;
`frontend` → `npm run dev`. Open <http://localhost:5173>.

## 6. Demo walkthrough (every use case)

1. **Admin sign-in:** `/admin` → email + `ADMIN_SEED_PASSWORD` → the 6-digit code is in the newest
   file in `backend/.dev-mail/`.
2. **Create an election (UC-08/09):** Elections → New election → add at least 2 candidates →
   **Schedule**.
3. **Register a voter (UC-01):** in another browser profile, go to `/register` → details → face
   check (blink, turn your head). Try it with a printed photo too: it's refused.
4. **Approve (UC-10):** Admin → Voters → Pending → Approve.
5. **Voter sign-in (UC-02):** `/login` → CNIC → face check → **Set up this device**
   (fingerprint/screen lock) → signed in.
6. **Open voting:** Admin → the election → **Open voting**. The admin page now shows live
   turnout only.
7. **Vote (UC-03/04/05):** voter → Vote → choose → review → confirm. Try voting again: refused.
8. **Close and publish (UC-13):** admin → Close voting → check the tally → Publish results.
9. **Results (UC-06) and history (UC-07):** voter home → Results / voting history.
10. **Fraud (UC-11, UC-15…18):** sign in five times with the wrong face for one CNIC → that
    account becomes LOCKED and a HIGH alert appears under Fraud alerts.
11. **Audit (UC-12):** Audit log → **Verify integrity** → "Chain intact".

For phones, see [mobile-testing.md](mobile-testing.md).

## 7. Tests

```bash
cd backend    && npm test              # needs MySQL + evoting_test
cd backend    && npm run load-test -- 500 50
cd frontend   && npm test && npm run test:e2e   # e2e: npx playwright install chromium first
cd ai-service && pytest
```

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend exits with "Invalid environment configuration" | the message lists each bad variable; compare with `.env.example` |
| `ALTER command denied … shadow` when running `db:migrate` | the shadow-database grants from the README are missing |
| `prisma migrate reset` refuses to run when started by an AI assistant | intended Prisma safety check; run it yourself if you really want to wipe the dev database |
| Face check always says "could not see your face clearly" | light the face from the front; face must be ≥ 80 px; one person only |
| "Turn left" never passes, "turn right" does (or vice versa) | the camera frames are mirrored on that device; see the yaw note in `ai-service/app/face_engine.py` |
| Fingerprint prompt never appears | not a secure context (use `localhost` or HTTPS), or `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGINS` don't match the address in the browser |
| Device worked yesterday, not today | the site's domain changed (e.g. a new tunnel URL); credentials are domain-bound, so use device recovery |
| `AI_UNAVAILABLE` (503) | the AI service isn't running, or `AI_SERVICE_TOKEN` differs between the two services |
| No anomaly alerts ever | the model isn't trained: run `python scripts/generate_synthetic.py` (rules still work without it) |

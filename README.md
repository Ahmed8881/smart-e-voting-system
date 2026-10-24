# Smart E-Voting System

Web-based e-voting with face recognition + liveness, device-bound fingerprint verification
(WebAuthn), and fraud detection. Final Year Project FYP-F25-05, Department of Software Engineering,
The University of Lahore.

Scope, design rules and build phases: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Layout

| Folder | What | Port |
|---|---|---|
| `frontend/` | React + Vite + TypeScript (voter and admin UI) | 5173 |
| `backend/` | Node.js + Express + TypeScript REST API — the only service the browser talks to | 4000 |
| `ai-service/` | Python + FastAPI: face enrol/verify, liveness, fraud scoring — internal only | 8001 |
| `docs/` | Documentation | — |
| `docker-compose.yml` | MySQL 8 for local development | 3306 |

## Prerequisites

- Node.js 22.9+ and npm
- Python 3.12
- MySQL 8 — either Docker Desktop (recommended) or a local MySQL 8 install (needed from Phase 1)
- git

## Setup (from a clean clone)

```bash
# 1. Configuration
cp .env.example .env          # then replace every CHANGE_ME (DB password appears in 3 places)
```

### 2. Database — pick one

**A. Docker (recommended):** `docker compose up -d`, then wait until `docker compose ps` shows
`mysql` as healthy. The init script in `docker/mysql-init/` also creates the `evoting_test`
database used by the backend tests.

**B. Local MySQL 8 install:** as root, run (use your `.env` password):

```sql
CREATE DATABASE evoting CHARACTER SET utf8mb4;
CREATE DATABASE evoting_test CHARACTER SET utf8mb4;
CREATE USER 'evoting'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON evoting.* TO 'evoting'@'localhost';
GRANT ALL PRIVILEGES ON evoting_test.* TO 'evoting'@'localhost';
-- needed by `prisma migrate dev` (shadow database):
GRANT ALL PRIVILEGES ON `prisma\_migrate\_shadow\_db%`.* TO 'evoting'@'localhost';
GRANT CREATE, DROP ON *.* TO 'evoting'@'localhost';
```

### 3. Backend

```bash
cd backend
npm install                   # also generates the Prisma client
npm run db:deploy             # apply migrations
npm run db:seed               # create the first admin from ADMIN_SEED_* in .env
npm run dev                   # http://localhost:4000/api/health
```

In development, emails (admin login codes) are written to `backend/.dev-mail/` instead of being
sent. Set `SMTP_URL` to send real mail.

### 4. AI service (new terminal)

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/activate        # Windows (PowerShell: .venv\Scripts\Activate.ps1)
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001    # http://localhost:8001/health
```

### 5. Frontend (new terminal)

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 — admin area at /admin
```

## Checks

Run in each folder:

| | Tests | Lint | Format | Types / build |
|---|---|---|---|---|
| `backend/` | `npm test` (needs MySQL + `evoting_test`) | `npm run lint` | `npm run format:check` | `npm run build` |
| `frontend/` | `npm test` | `npm run lint` | `npm run format:check` | `npm run build` |
| `ai-service/` | `pytest` | `ruff check .` | `ruff format --check .` | — |

## Security notes

- Secrets live only in `.env` (git-ignored). Never commit real values.
- The AI service has no public API docs and must not be exposed outside the internal network.

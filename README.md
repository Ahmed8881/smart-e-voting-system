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
cp .env.example .env          # then replace every CHANGE_ME

# 2. Database (from Phase 1 onward)
docker compose up -d          # wait until `docker compose ps` shows mysql as healthy

# 3. Backend
cd backend
npm install
npm run dev                   # http://localhost:4000/api/health

# 4. AI service (new terminal)
cd ai-service
python -m venv .venv
.venv/Scripts/activate        # Windows (Git Bash / PowerShell: .venv\Scripts\Activate.ps1)
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001    # http://localhost:8001/health

# 5. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 — shows "Backend: online"
```

## Checks

Run in each folder:

| | Tests | Lint | Format | Types / build |
|---|---|---|---|---|
| `backend/` | `npm test` | `npm run lint` | `npm run format:check` | `npm run build` |
| `frontend/` | `npm test` | `npm run lint` | `npm run format:check` | `npm run build` |
| `ai-service/` | `pytest` | `ruff check .` | `ruff format --check .` | — |

## Security notes

- Secrets live only in `.env` (git-ignored). Never commit real values.
- The AI service has no public API docs and must not be exposed outside the internal network.

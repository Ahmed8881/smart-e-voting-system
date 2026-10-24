# Smart E-Voting System — Project Brief for Claude Code (v2)

**Project:** Smart E-Voting System with AI-Based Biometric Authentication and Fraud Prevention
**Project ID:** FYP-F25-05, Department of Software Engineering, The University of Lahore
**Team:** Aisha Ishfaq (70141880, lead), Zainab Noor (70143685) · **Advisor:** Mr. Muhammad Rizwan Amin

This file is the source of truth for the build. It is reconciled against two documents:

- `FYP Proposal.pdf` — the original 8-page proposal.
- `finalzzzzz.pdf` — the 71-page FYP documentation: SRS (Chapter 2), use-case model with
  UC-01..UC-18 (Chapter 3), and design (Chapter 4: architecture, ERD, DFDs, class, sequence,
  state, component and deployment diagrams).

Where this brief differs from those documents, the difference is deliberate and listed in
**§4 Deviations**. Each deviation must also appear in `docs/design-decisions.md` (Phase 10) so
it can be defended at the viva.

---

## 1. Working rules

- Build in the phases in §10, **one phase at a time**. At the end of each phase: stop, summarise
  what was built, list how to run and test it, and wait for confirmation before the next phase.
- Never silently stub or fake a feature. If something can't be done properly, say so and propose
  an alternative before writing code.
- If a requirement is ambiguous, ask instead of guessing. Open questions are tracked in §12.
- Write tests alongside code. Every phase leaves `npm test` and `pytest` green.
- No hard-coded secrets. Config lives in `.env` (git-ignored) with a documented `.env.example`.
- Keep functions small, name things clearly, validate every input at the API boundary.
- Commit at the end of each phase with a clear message.
- Every feature references the use case(s) it implements (e.g. `UC-05`) in its PR/commit message,
  so the code traces back to the documentation (§9).

## 2. Scope

**In scope** (doc §1.9): voter registration, biometric enrolment, voter authentication, election
management, candidate management, vote casting, fraud monitoring, result generation, admin
dashboard, activity logs, live webcam capture.

**Out of scope** (doc §1.9, explicitly): blockchain, nationwide deployment, integration with
government (NADRA) databases, native mobile apps. The proposal's "optional blockchain" is replaced
by the hash-chained audit log (§5.11), which gives tamper-evidence without a chain.

## 3. Tech stack (decided — do not change without asking)

| Layer | Choice | Doc said |
|---|---|---|
| Frontend | React + Vite + TypeScript, React Router, Tailwind CSS, Recharts | HTML/CSS/JS, React ✔ |
| Backend API | Node.js + Express + TypeScript | Node.js + Express ✔ (Django dropped) |
| ORM / DB | Prisma + MySQL 8 | MySQL / MongoDB → MySQL (relational: unique constraints + transactions) |
| Validation | zod (backend + shared request schemas) | — |
| Auth | JWT access token (15 min) + refresh token in httpOnly, Secure, SameSite=Strict cookie | JWT ✔ |
| Passwords | bcrypt (cost 12) — **admins only** | voters had passwords (see D3) |
| Fingerprint | WebAuthn / passkeys via `@simplewebauthn/server` + `@simplewebauthn/browser` | scanner + templates (see D1) |
| Face + AI service | Python **3.12** + FastAPI, OpenCV (YuNet detector + SFace embeddings), MediaPipe Face Mesh for liveness, scikit-learn | Python, OpenCV, scikit-learn ✔ |
| Encryption at rest | AES-256-GCM for face embeddings (key from env) | AES/RSA → AES (see D8) |
| Transport | HTTPS everywhere (doc §2.2.5); mkcert locally | HTTPS ✔ |
| Testing | Vitest + Supertest (backend), Vitest + Testing Library (frontend), pytest (AI service) | — |
| Security middleware | helmet, cors (explicit origin), express-rate-limit | — |

**Machine prerequisites:** Node 22, Python 3.12, MySQL 8 (local install or Docker Compose), git, mkcert.
YuNet/SFace ONNX models are downloaded on first run with a SHA-256 check, not committed.

## 4. Deviations from the documentation (and why)

| # | Documentation says | We build | Why |
|---|---|---|---|
| D1 | Fingerprint scanner; `BIOMETRIC_DATA.fingerprint_template`; train on SOCOFing (UC-01 step 3, UC-02 step 3, §2.2.6) | WebAuthn platform authenticator (phone/laptop fingerprint or Face ID unlock). Store credential ID + public key, never a fingerprint. | Browsers and phones never expose raw fingerprint data to web apps, and a USB scanner would need a native driver/agent, which is out of scope (no native apps). SOCOFing matching would only work on uploaded images, not a live finger — it would be a fake feature. WebAuthn gives a real, cryptographically verifiable "this voter's device was unlocked by their fingerprint" factor. |
| D2 | `VOTE(vote_id, voter_id, election_id, candidate_id, vote_time)` | Split into `Participation(voter, election, votedAt)` and `Ballot(id, election, candidate)` with **no** voter link and **no** timestamp. | A vote row with `voter_id` + `candidate_id` breaks ballot secrecy (SRS 2.3.5 "maintain vote anonymity"). A precise timestamp could be joined against `votedAt` to re-identify. |
| D3 | `VOTER.password`; UC-02 "voter enters login details" | Voters identify by CNIC, then face + liveness, then WebAuthn. No voter passwords. | Doc §1.1 itself says passwords "can be stolen, shared, or manipulated". Two biometric-backed factors are stronger and simpler. |
| D4 | Real-time vote counting and live result dashboards (SRS 2.3.7, UC-05 step 6) | **Turnout** is real-time (voted / eligible, live chart). Per-candidate counts are computed at close and shown after the admin publishes. | Live per-candidate counts influence voters still to vote and, with low turnout, can leak individual choices. Real elections embargo results until polls close. *Needs advisor sign-off — see Q1.* |
| D5 | UC-17 "AI engine detects multiple voting attempts" | One-person-one-vote is enforced by a DB unique constraint inside a transaction. A rejected second attempt *then* raises a fraud alert. | An ML model cannot guarantee a hard rule; a constraint can, including under race conditions. AI is used where it fits: anomaly scoring (§7). |
| D6 | Face model trained on VGGFace2 | Pretrained SFace model; we evaluate verification accuracy (FAR/FRR at our threshold) on a small public test set and report it. | Training a face model on 3.3M VGGFace2 images is not feasible for an FYP and would not beat a published pretrained model. |
| D7 | Fraud model trained on "Voter dataset (Kaggle/Generated)" | Synthetic labelled login-event dataset generated by `generate_synthetic.py`, clearly labelled as synthetic. | No real e-voting fraud dataset exists; the doc already allows "Generated". |
| D8 | AES/RSA encryption | AES-256-GCM at rest for embeddings; TLS in transit; WebAuthn uses public-key crypto (ES256/RS256). | No separate RSA layer is needed — TLS and WebAuthn already cover the asymmetric part. |
| D9 | Admin-only voter "verification" (UC-10) | Explicit status lifecycle `PENDING → APPROVED`, plus `SUSPENDED`/`LOCKED`; only `APPROVED` voters can vote. | Makes UC-10 and the voter state diagram (Fig 4.9) concrete and testable. |
| D10 | Optional blockchain (proposal) | Hash-chained append-only audit log + verify endpoint. | Doc §1.9 puts blockchain out of scope; the hash chain delivers the tamper-evidence goal. |

## 5. Key design rules

1. **Ballot secrecy.** Never store `voterId` alongside `candidateId`.
   - `Participation(voterId, electionId, votedAt)` with UNIQUE(voterId, electionId).
   - `Ballot(id UUID, electionId, candidateId)` — no voter link, no timestamp.
   - Both rows inserted in **one transaction**. A unique-constraint failure rolls back both.
     This, not an "already voted?" pre-check, enforces one-person-one-vote.
   - `Ballot.id` must be a random UUID v4 (never auto-increment or time-ordered UUIDs) so ids don't leak
     cast order that could be joined against `Participation.votedAt`. A test enforces this.
2. **Fingerprint = WebAuthn.** Store `credentialId`, `publicKey`, `signCount`, `transports`.
   Face recognition is the identity check; WebAuthn proves possession of the enrolled, unlocked device.
3. **Voter login (UC-02)** = CNIC → face match with liveness → WebAuthn assertion. Both factors
   must pass before tokens are issued.
4. **Liveness** for registration and login: randomised challenge (e.g. "turn head left", "blink")
   verified across several frames with MediaPipe Face Mesh. A static photo or photo-of-a-photo must fail.
5. **Duplicate registration (UC-01 alt flow).** New face embedding compared 1:N against all
   stored embeddings; above threshold → reject + HIGH fraud alert. CNIC UNIQUE and format-validated
   (`#####-#######-#`). Email UNIQUE.
6. **Admin approval.** New voters start `PENDING`; admin can `APPROVE` or `SUSPEND`.
7. **Results hidden while voting** (D4). During `ACTIVE`, admins see live turnout only. Tally computed
   on close; voters see results only after `PUBLISHED`.
8. **Vote history (UC-07)** shows participation only ("You voted in X on date Y"), never the candidate.
9. **Election rules.** One position per election, single choice. All `APPROVED` voters are eligible for
   every election (documented assumption). Candidates are locked once an election is `ACTIVE`.
10. **Election lifecycle:** `DRAFT → SCHEDULED → ACTIVE → CLOSED → PUBLISHED`, validated server-side.
    Votes accepted only in `ACTIVE` and between `startsAt`/`endsAt`. UC-13 "generate results" is only
    allowed after `CLOSED` (matches the UC-13 alt flow).
11. **Tamper-evident audit log (UC-12).** Every admin action and auth event is appended to `AuditLog`;
    each row stores SHA-256 of the previous row. `GET /admin/audit-log/verify` walks the chain.
12. **Lost device recovery.** Voter re-verifies face + liveness → admin approves enrolment of a new
    WebAuthn credential → old credentials revoked.

**Voter states** (implements Fig 4.9): `UNREGISTERED → PENDING → APPROVED`; `APPROVED ⇄ SUSPENDED`;
`APPROVED → LOCKED` (HIGH fraud alert) → `APPROVED` after admin review. "Voted" is per election
(a `Participation` row), not a global voter state. Auth failure and duplicate vote produce
"access denied" / "rejected" responses plus auth events, as in the diagram.

## 6. Data model (Prisma — reconciled with ERD Fig 4.2)

| Model | Fields | Maps to ERD |
|---|---|---|
| `Admin` | id, name, email UNIQUE, passwordHash, role (`ADMIN`), createdAt | ADMIN (+role kept from ERD) |
| `Voter` | id, name, email UNIQUE, cnic UNIQUE, status `PENDING\|APPROVED\|SUSPENDED\|LOCKED`, approvedById?, createdAt | VOTER (password removed, D3) |
| `FaceTemplate` | id, voterId UNIQUE, embeddingCiphertext, iv, authTag, modelVersion, createdAt | BIOMETRIC_DATA.face_template |
| `WebAuthnCredential` | id, voterId, credentialId UNIQUE, publicKey, signCount, transports, createdAt, revokedAt? | BIOMETRIC_DATA.fingerprint_template (D1) |
| `Election` | id, title, description, startsAt, endsAt, status, createdById → Admin | ELECTION |
| `Candidate` | id, electionId, name, party, symbolUrl, createdById → Admin | CANDIDATE (admin_id kept) |
| `Participation` | voterId, electionId, votedAt — composite PK | VOTE (voter half, D2) |
| `Ballot` | id UUID, electionId, candidateId | VOTE (choice half, D2) |
| `ResultTally` | electionId, candidateId, voteCount, computedAt | RESULT (per-candidate rows; total = sum) |
| `AuthEvent` | id, voterId?, cnicAttempted, type, success, ip, userAgent, deviceHash, createdAt | AUTH_LOG (login_status/login_time) |
| `FraudAlert` | id, voterId?, electionId?, type, severity `LOW\|MEDIUM\|HIGH`, score, description, details JSON, status `OPEN\|REVIEWED\|DISMISSED`, createdAt, reviewedById? | FRAUD_ALERT |
| `AuditLog` | id, actorType, actorId, action, payload JSON, prevHash, hash, createdAt | "Activity Logs" (SRS 2.3.8) |
| `SystemSetting` | key, value | UC-14 Manage System Settings |

`deviceHash` = SHA-256 of a random device ID stored in a long-lived first-party cookie +
user-agent (not IP; IP is stored separately). *Confirm — Q3.*

## 7. Fraud detection (UC-15 .. UC-18)

Two layers, both write `FraudAlert` rows and appear on the admin fraud dashboard (UC-11).

**Rules (deterministic, synchronous) — these are the only thing that can block:**
- ≥ N failed logins for one CNIC within M minutes → alert; HIGH locks the account pending review.
- Same device hash / IP used for logins to ≥ K different voter accounts within a window.
- Vote attempt after already voting (constraint violation) → alert (UC-17).
- Duplicate face at registration → HIGH alert (UC-01 alt flow).
- Liveness failure ≥ 3 times.
- WebAuthn `signCount` did not increase (possible cloned credential) → HIGH alert.

N, M, K and thresholds come from `SystemSetting` and are editable in UC-14.

**Anomaly model (Isolation Forest, AI service) — UC-15/16, alerts only, never blocks:**
- Features per login: hour of day, failed attempts in last hour, new-device flag, new-IP flag,
  distinct accounts on this device in 24h, time since registration, face similarity score.
- `ai-service/scripts/generate_synthetic.py` builds a labelled synthetic dataset (normal + injected
  anomalies), trains the model, saves it with a version, and reports precision/recall on a held-out
  split. Documented as synthetic-data-trained (D7).
- Score above threshold → MEDIUM alert.

## 8. API (REST, JSON, prefix `/api`)

Auth: `POST /auth/admin/login` (password → emails OTP), `POST /auth/admin/otp` (→ tokens),
`POST /auth/refresh`, `POST /auth/logout`,
`POST /auth/voter/face` (step 1), `POST /auth/voter/webauthn/options`,
`POST /auth/voter/webauthn/verify` (step 2 → tokens).

Voter: `POST /voters/register/challenge` (liveness challenge), `POST /voters/register`, `POST /voters/me/webauthn/register/options|verify`,
`GET /elections/active`, `GET /elections/:id/candidates`, `POST /elections/:id/vote`,
`GET /me/participation`, `GET /elections/:id/results` (published only), recovery endpoints (Phase 4).

Admin: `GET /admin/me`, CRUD `/admin/elections`, `/admin/elections/:id/candidates`,
`POST /admin/elections/:id/{schedule|open|close|publish}`, `GET /admin/elections/:id/turnout`,
`GET /admin/voters?status=`, `POST /admin/voters/:id/{approve|suspend|unlock}`,
`GET /admin/fraud-alerts`, `PATCH /admin/fraud-alerts/:id`, `GET /admin/audit-log`,
`GET /admin/audit-log/verify`, `GET|PUT /admin/settings`, `GET /admin/reports/summary` (UC-12).

All admin routes require role `ADMIN`. One error shape everywhere:
`{ "error": { "code": "STRING", "message": "human readable" } }`.

The browser talks only to the backend. The AI service is internal, called by the backend with a
shared service token, never exposed publicly (matches the layered architecture, Fig 4.1).

## 9. Use-case traceability

| UC | Name | Phase | Notes |
|---|---|---|---|
| UC-01 | Register Voter | 3 | + liveness, 1:N duplicate check |
| UC-02 | Login / Authenticate | 2, 4 | face + liveness, then WebAuthn (D1, D3) |
| UC-03 | View Ongoing Elections | 6 | |
| UC-04 | View Candidates | 6 | |
| UC-05 | Cast Vote | 6 | confirmation step, transactional insert (D2) |
| UC-06 | View Results | 7 | published only (D4) |
| UC-07 | View Vote History | 6 | participation only |
| UC-08 | Manage Elections | 5 | lifecycle state machine |
| UC-09 | Manage Candidates | 5 | locked once ACTIVE |
| UC-10 | Manage Voters | 3 | approve / suspend / unlock |
| UC-11 | Monitor Fraud Alerts | 8 | review workflow |
| UC-12 | View Reports & Logs | 1, 7, 8 | audit log + verify, turnout, summary report |
| UC-13 | Generate Results | 7 | only after CLOSED |
| UC-14 | Manage System Settings | 1, 8 | thresholds, N/M/K |
| UC-15 | Analyze Activities | 8 | Isolation Forest scoring |
| UC-16 | Detect Suspicious Behavior | 8 | rules + anomaly score |
| UC-17 | Detect Multiple Voting Attempts | 6, 8 | constraint + alert (D5) |
| UC-18 | Generate Fraud Alerts | 8 | |

## 10. Build phases

**Phase 0 — Scaffold.** `git init`, monorepo folders (`/frontend`, `/backend`, `/ai-service`, `/docs`),
Docker Compose (MySQL), TS configs, lint + format, test runners wired, `.env.example`, README setup
steps, health endpoints for backend and AI service.

**Phase 1 — Database + admin auth.** Prisma schema (§6) + first migration, seed one admin from env,
admin login/refresh/logout, RBAC middleware, helmet/cors/rate-limit, audit log with hash chain, settings.

**Phase 2 — Face service.** FastAPI: enrol (frames → embedding), verify (frames + stored embedding →
similarity + decision), liveness challenge issue/verify. Encryption happens in the backend. Unit tests
with sample images, including a photo-of-a-photo liveness case. Report FAR/FRR at the chosen threshold (D6).

**Phase 3 — Voter registration (UC-01, UC-10).** Webcam capture UI with liveness challenge, CNIC
validation, 1:N duplicate check, PENDING status, admin approve/suspend screens.

**Phase 4 — WebAuthn (UC-02).** Credential registration after approval, two-step voter login, lost-device
recovery. Must work in mobile Chrome and Safari over HTTPS (document mkcert / tunnel testing).

**Phase 5 — Elections and candidates (UC-08, UC-09).** Admin CRUD, lifecycle state machine with tests for
every valid and invalid transition, candidate locking once ACTIVE.

**Phase 6 — Voting (UC-03, 04, 05, 07, 17).** Ballot screen, confirmation step, transactional insert,
concurrency test proving two simultaneous votes from one voter produce exactly one ballot.

**Phase 7 — Results (UC-06, UC-13, UC-12).** Tally on close, publish flow, live turnout view, Recharts charts.

**Phase 8 — Fraud detection (UC-11, 15, 16, 18).** Rules engine, synthetic data + Isolation Forest, alert
dashboard with review workflow, account lock on HIGH alerts.

**Phase 9 — Hardening.** OWASP Top 10 pass, input fuzzing on key endpoints, error-path tests, responsive
mobile layout, accessibility basics, basic load test for concurrent voting (SRS 2.4.2 scalability).

**Phase 10 — Documentation.** API reference, Mermaid architecture diagram, setup guide,
`design-decisions.md` (§4 expanded), and updated ERD/class diagrams that match the built schema, so the
FYP report can replace Figs 4.2 and 4.5.

## 11. Definition of done (every phase)

- Runs from a clean clone using only the README steps.
- Tests pass; new logic has tests, including failure paths.
- No secrets in code; no logging of sensitive data (embeddings, tokens, CNICs).
- Use cases implemented are listed in the phase report.
- Stopped and reported back.

## 12. Open questions (answer before the listed phase)

- **Q1 (before Phase 7) — live results.** The SRS asks for real-time per-candidate results; this brief
  embargoes them (D4). Has the advisor accepted that? If not, the fallback is a per-election
  `liveResults` flag, off by default, with the risk written up.
- **Q2 — OTP. Decided (default): (b), email OTP for admin login.** Original question: The architecture diagram (Fig 4.1, module 3.2) lists "OTP verification"
  and the SRS glossary defines OTP, but no use case uses it. Options: (a) drop it and note that WebAuthn
  replaces it, (b) email OTP as a second factor for **admin** login. Recommendation: (b) — it's cheap and
  matches the diagram. In dev, emails go to a local Mailpit container.
- **Q3 — deviceHash. Decided (default): definition in §6.**
- **Q4 (before Phase 1) — MySQL.** Docker Desktop is not installed on the dev machine. Phase 1 needs MySQL 8,
  either via Docker Desktop (`docker compose up -d`) or a local MySQL 8 install.
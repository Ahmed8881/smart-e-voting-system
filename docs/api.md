# API reference

Base URL: `/api` (the browser reaches it through the frontend's own origin; in development Vite
proxies `/api` to `http://localhost:4000`). JSON in and out.

**Every error** has one shape:

```json
{ "error": { "code": "STRING_CODE", "message": "Human readable" } }
```

Common codes: `VALIDATION_ERROR` 400, `INVALID_JSON` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403,
`NOT_FOUND` 404, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429, `AI_UNAVAILABLE` 503,
`INTERNAL_ERROR` 500 (never carries details).

**Authentication:** `Authorization: Bearer <accessToken>` (JWT, 15 minutes, audience `api`). The
refresh token is an httpOnly, Secure, SameSite=Strict cookie `rt` scoped to `/api/auth`.
**Rate limits:** 300 requests/minute per signed-in account (per IP when anonymous); admin login
20 per 15 minutes per IP; voter auth 60 and registration 30 per 15 minutes per IP.

Use-case references (UC-xx) are from the FYP documentation, Chapter 3.

---

## Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | — | `{ status: "ok", service: "backend" }` |

## Sessions (both roles)

| Method | Path | Auth | Body | Response / notes |
|---|---|---|---|---|
| POST | `/auth/refresh` | `rt` cookie | — | `{ accessToken, role }`, rotates the cookie. A reused (already rotated) token revokes all the account's sessions. 401 if the account is no longer active. |
| POST | `/auth/logout` | `rt` cookie | — | 204, revokes the cookie's token |

## Admin authentication (password + emailed OTP)

| Method | Path | Body | Response / errors |
|---|---|---|---|
| POST | `/auth/admin/login` | `{ email, password }` | `{ otpRequired: true, challengeId }`; a 6-digit code is emailed. 401 `INVALID_CREDENTIALS` (same for an unknown email) |
| POST | `/auth/admin/otp` | `{ challengeId, code }` | `{ accessToken, admin: { id, name, email } }` + `rt` cookie. 401 `OTP_INVALID` (wrong, expired, used, or 5 attempts exceeded) |

## Voter registration (UC-01)

| Method | Path | Body | Response / errors |
|---|---|---|---|
| POST | `/voters/register/challenge` | — | `{ challengeToken, actions: ["BLINK","TURN_LEFT"], expiresAt }`: a single-use liveness challenge, valid 2 minutes |
| POST | `/voters/register` | `{ name, email, cnic: "#####-#######-#", challengeToken, frames: [6..30 JPEG data URLs] }` (≤ 3 MB) | 201 `{ id, status: "PENDING" }`. 409 `ALREADY_REGISTERED` (email/CNIC), 409 `DUPLICATE_FACE` (+ HIGH fraud alert), 422 `LIVENESS_FAILED`, 400 `CHALLENGE_USED` / `CHALLENGE_INVALID` |

## Voter sign-in (UC-02): face, then device

| Method | Path | Body | Response / errors |
|---|---|---|---|
| POST | `/auth/voter/challenge` | — | as registration challenge |
| POST | `/auth/voter/face` | `{ cnic, challengeToken, frames }` (≤ 3 MB) | `{ faceToken, next: "WEBAUTHN_LOGIN" \| "WEBAUTHN_ENROL", recoveryPending }`. 401 `FACE_NOT_VERIFIED` (also for unknown CNIC), 403 `ACCOUNT_NOT_ACTIVE` (pending/suspended/locked, with reason), 422 `LIVENESS_FAILED` |
| POST | `/auth/voter/webauthn/options` | `{ faceToken }` (next = LOGIN) | WebAuthn `PublicKeyCredentialRequestOptionsJSON` (user verification required) |
| POST | `/auth/voter/webauthn/verify` | `{ faceToken, response }` | `{ accessToken, voter: { id, name } }` + `rt` cookie. 401 `WEBAUTHN_FAILED` (a counter regression also raises a HIGH alert), 400 `WEBAUTHN_CHALLENGE_INVALID` (replay) |
| POST | `/voters/me/webauthn/register/options` | `{ faceToken }` (next = ENROL) | `PublicKeyCredentialCreationOptionsJSON` (platform authenticator, UV required). 409 `DEVICE_ALREADY_REGISTERED` |
| POST | `/voters/me/webauthn/register/verify` | `{ faceToken, response }` | 201 `{ accessToken, voter }`: the device is stored and the voter is signed in |
| POST | `/auth/voter/recovery` | `{ faceToken }` (next = LOGIN) | 202 `{ status: "PENDING" }`: lost-device request for an admin |

`faceToken`: JWT, 5 minutes, audience `voter-face-step`. It is not an access token.

## Signed-in voter (role VOTER)

| Method | Path | Response / notes | UC |
|---|---|---|---|
| GET | `/me` | `{ id, name, email, status }` | — |
| GET | `/me/participation` | `[{ id, title, status, votedAt }]`: never the candidate | UC-07 |
| GET | `/elections/active` | `[{ id, title, description, startsAt, endsAt, hasVoted, open }]` | UC-03 |
| GET | `/elections/published` | `[{ id, title, endsAt }]` | — |
| GET | `/elections/:id/candidates` | `{ election, candidates: [{ id, name, party, symbolUrl }] }`; 404 for DRAFT | UC-04 |
| POST | `/elections/:id/vote` | body `{ candidateId }` → 201 `{ recorded: true }` (no candidate echoed). 409 `ALREADY_VOTED` (+ MEDIUM alert), 409 `ELECTION_NOT_OPEN`, 400 `INVALID_CANDIDATE`, 403 `ACCOUNT_NOT_ACTIVE` | UC-05 |
| GET | `/elections/:id/results` | `{ election, turnout: { voted, eligible, percent }, totalVotes, computedAt, results: [{ candidateId, name, party, symbolUrl, votes, percent }] }`; 403 `RESULTS_NOT_PUBLISHED` | UC-06 |

## Admin (role ADMIN), prefix `/admin`

| Method | Path | Body / query | Response / notes | UC |
|---|---|---|---|---|
| GET | `/me` | — | `{ id, name, email }` | — |
| GET | `/audit-log` | `page`, `pageSize ≤ 100` | `{ items, total, page, pageSize }`, newest first | UC-12 |
| GET | `/audit-log/verify` | — | `{ valid: true, checked }` or `{ valid: false, checked, brokenAtId, reason: PREV_HASH_MISMATCH \| HASH_MISMATCH \| HEAD_MISMATCH }` | UC-12 |
| GET | `/settings` | — | all settings with defaults | UC-14 |
| PUT | `/settings` | `{ "<key>": value, … }` | updated settings; old → new values audited. 400 for unknown keys or out-of-range values | UC-14 |
| GET | `/voters` | `status`, `search`, `page`, `pageSize` | `{ items: [{ id, name, email, cnic, status, createdAt }], total, … }` | UC-10 |
| POST | `/voters/:id/approve` | — | from PENDING / SUSPENDED / LOCKED → APPROVED; 409 `INVALID_STATUS_TRANSITION` | UC-10 |
| POST | `/voters/:id/suspend` | — | from PENDING / APPROVED / LOCKED → SUSPENDED | UC-10 |
| GET | `/recovery-requests` | `status` (default PENDING) | requests with voter details | — |
| POST | `/recovery-requests/:id/approve` | — | revokes all the voter's credentials; `{ id, status, credentialsRevoked }`; 409 `ALREADY_DECIDED` | — |
| POST | `/recovery-requests/:id/reject` | — | `{ id, status: "REJECTED" }` | — |
| GET | `/elections` | — | elections with `candidateCount` | UC-08 |
| POST | `/elections` | `{ title, description?, startsAt, endsAt }` (ISO with timezone) | 201, status DRAFT | UC-08 |
| GET | `/elections/:id` | — | election with candidates | UC-08 |
| PATCH | `/elections/:id` | any of the create fields | only DRAFT/SCHEDULED; 409 `ELECTION_LOCKED` | UC-08 |
| DELETE | `/elections/:id` | — | only DRAFT | UC-08 |
| POST | `/elections/:id/schedule` | — | DRAFT → SCHEDULED (≥ 2 candidates, end in future) | UC-08 |
| POST | `/elections/:id/open` | — | SCHEDULED → ACTIVE | UC-08 |
| POST | `/elections/:id/close` | — | ACTIVE → CLOSED; computes the tally in the same transaction | UC-13 |
| POST | `/elections/:id/publish` | — | CLOSED → PUBLISHED | UC-13 |
| GET | `/elections/:id/turnout` | — | `{ voted, eligible, percent }`: any time, counts only | UC-12 |
| GET | `/elections/:id/results` | — | as voter results + `status`, `consistent`; 409 `RESULTS_HIDDEN` before close | UC-13 |
| POST | `/elections/:id/candidates` | `{ name, party, symbolUrl? (https) }` | 201; only DRAFT/SCHEDULED | UC-09 |
| PATCH | `/elections/:id/candidates/:candidateId` | partial | only DRAFT/SCHEDULED | UC-09 |
| DELETE | `/elections/:id/candidates/:candidateId` | — | only DRAFT/SCHEDULED | UC-09 |
| GET | `/fraud-alerts` | `status`, `severity`, `page`, `pageSize` | `{ items (with voter, election), total, openBySeverity }` | UC-11 |
| PATCH | `/fraud-alerts/:id` | `{ status: "REVIEWED" \| "DISMISSED" }` | only OPEN alerts; 409 `ALREADY_REVIEWED` | UC-11 |

Election state transitions all return 409 `INVALID_TRANSITION`, `NOT_ENOUGH_CANDIDATES` or
`ELECTION_ENDED` when refused.

---

## AI service (internal only, never exposed to browsers)

Base `http://localhost:8001`. Every endpoint except `/health` requires `X-Service-Token`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | — | `{ status, service }` |
| POST | `/liveness/challenge` | — | `{ token, nonce, actions, expiresAt }` |
| POST | `/face/enrol` | `{ challengeToken, frames[1..30] }` | `{ nonce, live, reason, modelVersion, frameCount, embedding: base64 128×float32 \| null }` |
| POST | `/face/verify` | `+ referenceEmbedding` | `{ nonce, live, reason, modelVersion, frameCount, similarity \| null }` |
| POST | `/fraud/score` | `{ hour_of_day, failed_attempts_last_hour, new_device, new_ip, accounts_on_device_24h, days_since_registration, face_similarity }` | `{ score: 0..1, modelVersion }`; 503 `MODEL_NOT_TRAINED` |

Liveness `reason` values: `TOO_FEW_FRAMES`, `MULTIPLE_FACES`, `FACE_NOT_TRACKED`,
`FACE_NOT_CLEAR`, `IDENTITY_CHANGED`, `ACTION_NOT_DETECTED:<action>`.

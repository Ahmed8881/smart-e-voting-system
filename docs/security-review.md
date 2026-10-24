# Security review (Phase 9) — OWASP Top 10 (2021)

What was checked, what was found and fixed, and the risks that remain. Re-run the automated parts
with the commands at the end.

## Findings fixed in this phase

| # | Finding | Category | Fix | Test |
|---|---|---|---|---|
| 1 | A suspended or locked voter could keep refreshing their session indefinitely (voting was still blocked, reading wasn't) | A01 Broken access control | Refresh checks the account is still active (voter `APPROVED`, admin exists) and revokes all its sessions if not | `voter-auth.test.ts` › session after the account changes |
| 2 | `isSettingKey` used `in`, so `{"toString": …}` or `__proto__` passed the check → 500 | A03 Injection / input validation | `Object.hasOwn` | `fuzz.test.ts` (found by the fuzzer; confirmed by reverting the fix) |
| 3 | Unhandled errors were logged with their message; Prisma validation errors can quote query values such as a CNIC | A09 Logging | Production logs only the error name and code | `fuzz.test.ts` › generic 500 |
| 4 | Global rate limit was per IP: a campus or mobile network sharing one public IP would lock voters out on election day (found by the load test: 300 of 600 requests got 429) | A04 Insecure design / availability | Signed-in requests are limited per account, anonymous ones per IP | `app.test.ts` › global rate limit; load test |
| 5 | Admin nav overflowed phone screens; hidden table headers stretched pages; chart was focusable inside `aria-hidden`; scrollable tables weren't keyboard-reachable | Accessibility | Wrapping nav, positioned + focusable + labelled scroll regions, Recharts `accessibilityLayer` off (the table is the data) | `e2e/pages.e2e.ts` (axe + overflow, mobile + desktop) |

## Checklist

| OWASP 2021 | Controls in place |
|---|---|
| **A01 Broken access control** | Every admin route behind `requireRole(ADMIN)`, voter routes behind `requireRole(VOTER)`; JWT audiences separate access tokens from face-step tokens; voter status re-checked when voting and refreshing; results gated by election status; DRAFT elections invisible to voters; object ids validated as UUIDs and ownership checked (candidate ↔ election, credential ↔ voter) |
| **A02 Cryptographic failures** | AES-256-GCM for face embeddings, voter id bound as AAD; bcrypt 12 for admin passwords; refresh tokens 256-bit random, stored as SHA-256; HMAC-signed liveness challenges; HTTPS required for camera/WebAuthn outside localhost; secrets only in `.env`, validated at startup |
| **A03 Injection** | Prisma with parameters; the few raw queries are tagged templates (parameterised); zod at every API boundary (unknown keys stripped); React escapes output; candidate symbol URLs must be `https:` |
| **A04 Insecure design** | One-person-one-vote enforced by a DB primary key inside a transaction, not an app check; ballot table has no voter link and no timestamp; results hidden until close; two factors for voters, password + OTP for admins; anomaly model can alert but never block |
| **A05 Security misconfiguration** | helmet headers, explicit CORS origin, `x-powered-by` off, API docs off on the AI service, AI service only reachable with a service token, MySQL bound to 127.0.0.1 in Docker, body size limits (100 KB, 3 MB only for camera frames), standard error shape with no stack traces |
| **A06 Vulnerable components** | `npm audit` (backend, frontend): 0 vulnerabilities; `pip-audit -r requirements.txt`: none found (2026-10-24). Model files pinned by SHA-256 |
| **A07 Identification & authentication failures** | Admin: per-IP login limit + OTP (5 attempts, 5 minutes, single use) + timing-equalised password check; voters: liveness face match + WebAuthn with user verification; rotating refresh tokens with reuse detection; HIGH fraud alerts lock accounts |
| **A08 Software & data integrity failures** | Hash-chained audit log with a verify endpoint; tally consistency (ballots = participations) checked at close and on every admin read; WebAuthn counter regression detection |
| **A09 Logging & monitoring failures** | Every admin action and auth event in the audit log / `AuthEvent`; fraud alert dashboard; no tokens, CNICs or embeddings in application logs |
| **A10 SSRF** | The server never fetches user-supplied URLs; the AI service URL comes from configuration only |

## Residual risks — known, accepted for an FYP, worth stating at the viva

1. **Database binary log can link voters to ballots.** The participation row and the ballot row are
   written in one transaction (required for one-person-one-vote), and MySQL's binary log records a
   transaction's rows together. Someone with binlog access could pair them. Mitigations for a real
   deployment: run MySQL with `skip-log-bin` (or a short binlog retention), and restrict DBA access.
   The general query log must stay off.
2. **CNIC existence is revealed to whoever types it.** A pending or suspended voter needs to be
   told why they can't sign in, so the face step answers 403 with the reason for registered CNICs.
   Rate limits and the failed-login rule bound the abuse.
3. **Device hash is a weak signal.** It's a cookie plus user agent; clearing cookies changes it.
   It feeds alerts only.
4. **Single-instance assumptions.** Rate-limit counters are in memory and the face engine
   serialises frames per process. Running several backend instances needs a shared store, such as
   Redis, for the rate limiter.
5. **The anomaly model is loaded with joblib (pickle).** Only load model files you trained yourself.
   They're written to the git-ignored `ai-service/models/` and never accepted from users.
6. **Admin OTP by email** is only as strong as the admin's mailbox. A real deployment would prefer
   TOTP or a hardware key for admins.
7. **Liveness** stops photos and simple replays. It isn't certified presentation-attack detection
   (it can't stop deepfake video injection or high-quality 3D masks).

## Performance (load test)

`npm run load-test -- 500 50` on the development laptop (Windows 11, local MySQL 8.4, Prisma pool
of 10): 500 voters plus 100 repeat attempts at 50 concurrent requests → **500 ballots,
500 participations, 100 repeat attempts refused, 0 server errors**, ~73 requests/s,
p50 733 ms, p95 825 ms. Throughput is bounded by the connection pool and the transaction locks
that make one-person-one-vote safe. Raise `connectionLimit` in `src/db.ts` for bigger elections.

## Re-running the checks

```bash
cd backend   && npm test && npm audit && npm run load-test -- 500 50
cd frontend  && npm test && npm run test:e2e && npm audit
cd ai-service && pytest && pip-audit -r requirements.txt
```

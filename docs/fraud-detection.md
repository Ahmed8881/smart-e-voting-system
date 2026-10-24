# Fraud detection (UC-15 … UC-18)

Two layers. Both write `FraudAlert` rows that admins review on **Admin → Fraud alerts**.

| Layer | Decides | Can block? |
|---|---|---|
| **Rules** (backend, deterministic, run on every auth event) | yes/no from counts | **Yes** — a HIGH alert about a voter locks the account until an admin reviews it |
| **Anomaly model** (AI service, Isolation Forest) | a 0–1 "how unusual" score | **No** — it only raises MEDIUM alerts |

## Rules

Thresholds are in **Admin → Settings** (`SystemSetting`), so they can be tuned without a deploy.

| Rule | Trigger | Severity | Effect |
|---|---|---|---|
| Repeated failed logins | ≥ `fraud.maxFailedLogins` (5) failed face / liveness / device checks for one person within `fraud.failedLoginWindowMinutes` (15) | HIGH | account **LOCKED** |
| Repeated liveness failure | ≥ `fraud.maxLivenessFailures` (3) liveness failures (registration or login) in the same window | MEDIUM | alert |
| Shared device | ≥ `fraud.maxAccountsPerDevice` (3) different CNICs from one device hash within `fraud.deviceWindowHours` (24) | MEDIUM | alert |
| Shared IP | same, per IP address | LOW | alert (weaker: campus Wi-Fi and mobile carriers share IPs) |
| Repeat vote attempt | a second vote hits the one-vote constraint | MEDIUM | vote refused by the database anyway |
| Duplicate face at registration | new face matches an enrolled voter (1:N) | HIGH | registration refused, existing account **LOCKED** |
| Cloned credential | WebAuthn signature counter did not increase | HIGH | sign-in refused, account **LOCKED** |
| Tally mismatch | ballots ≠ participations when an election closes | HIGH | alert (no voter to lock) |

While an alert of the same type for the same person/device/IP is still OPEN in the window, no
duplicate is raised. A locked voter is unlocked by approving them again on the **Voters** page,
which is a deliberate, audited admin action.

The device hash is SHA-256 of a random long-lived cookie plus the user agent. Clearing cookies
produces a new hash, so the device rule is a signal, not proof.

## Anomaly model

**Trained on synthetic data.** No public dataset of e-voting login fraud exists, so
`ai-service/scripts/generate_synthetic.py` generates one. Normal behaviour and five attack
patterns are written down in that script as explicit assumptions:

1. brute force — many failures, often at night
2. one device cycling through many identities
3. look-alike / weak spoof barely clearing the face threshold
4. fresh account used at once from a new device and network
5. stolen device taken somewhere new at night

Features per login: hour of day, failed attempts in the last hour, new device, new IP, distinct
accounts on this device in 24 h, days since registration, face similarity.

Training: 20 000 logins, 5 % anomalies, 75/25 stratified split. The Isolation Forest is fitted
**without labels**; the labels are used only to evaluate on the held-out quarter. Score =
sigmoid(−20 × decision_function), so 0.5 is the model's own boundary.

### Held-out results (synthetic, seed 42)

| Alert threshold | Precision | Recall |
|---|---|---|
| 0.5 | 85.1 % | 82.4 % |
| **0.6 (default `fraud.anomalyThreshold`)** | **93.0 %** | **74.8 %** |
| 0.7 | 99.3 % | 54.4 % |
| 0.8 | 100 % | 25.2 % |

**What these numbers do and don't mean:** they show the model separates the five patterns
*we invented* from the normal behaviour *we invented*. They are not a measure of real-world
fraud detection. That is why the model can never block anyone, and why every alert goes to a
human. With real usage logs, the model should be retrained and re-evaluated.

Reproduce: `cd ai-service && python scripts/generate_synthetic.py`. This writes
`models/anomaly.joblib`, `models/anomaly.json` (version, features, metrics, a "synthetic"
note) and `data/synthetic_logins.csv`. If the model hasn't been trained, the backend skips scoring
and the rules still run.

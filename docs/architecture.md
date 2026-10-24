# Architecture

These diagrams describe the system as built. They can replace Figures 4.1 (architecture), 4.2
(ERD), 4.7 (sequence) and 4.9 (state) in the FYP report. All are Mermaid; they render on GitHub,
or paste them into <https://mermaid.live> to export images.

## Components (replaces Fig 4.1)

```mermaid
flowchart LR
  subgraph Browser["Browser / phone"]
    UI["React SPA<br/>voter + admin UI"]
    CAM["Camera<br/>getUserMedia"]
    AUTHN["Platform authenticator<br/>fingerprint / Face ID<br/>(WebAuthn)"]
  end

  subgraph Server["Application server"]
    API["Backend API<br/>Node.js + Express + TypeScript"]
    AI["AI service<br/>Python + FastAPI<br/>YuNet · SFace · MediaPipe<br/>Isolation Forest"]
  end

  DB[("MySQL 8<br/>Prisma")]
  MAIL["SMTP<br/>admin OTP"]

  UI -- "HTTPS /api (JSON, JWT)" --> API
  CAM -. frames .-> UI
  AUTHN -. signed assertion .-> UI
  API -- "HTTP + X-Service-Token<br/>(internal only)" --> AI
  API --> DB
  API --> MAIL
```

The browser talks only to the backend. The AI service is reachable only from the backend, with a
shared service token. The AI service never sees voter identities, only frames and embeddings, and
it never touches the database.

Backend modules (`backend/src/modules/`):

| Module | Responsibility | UC |
|---|---|---|
| `auth` | admin password + OTP, voter face step, WebAuthn, sessions | UC-02 |
| `voters` | registration, admin voter management, recovery requests, `/me` | UC-01, UC-07, UC-10 |
| `face` | liveness challenges (single-use), 1:N face search | UC-01, UC-02 |
| `elections` | lifecycle state machine, candidates | UC-08, UC-09 |
| `voting` | ballot, transactional vote, published results | UC-03…UC-06 |
| `results` | tally on close, turnout, consistency check | UC-12, UC-13 |
| `fraud` | rules engine, anomaly scoring hook, alert review | UC-11, UC-15…UC-18 |
| `audit` | hash-chained append-only log + verification | UC-12 |
| `settings` | tunable thresholds | UC-14 |

## Registration (UC-01)

```mermaid
sequenceDiagram
  actor V as Voter
  participant UI as React app
  participant API as Backend
  participant AI as AI service
  participant DB as MySQL

  V->>UI: name, email, CNIC
  UI->>API: POST /voters/register/challenge
  API->>AI: POST /liveness/challenge
  AI-->>API: signed token, nonce, [BLINK, TURN_LEFT]
  API->>DB: store nonce (single use)
  API-->>UI: token + actions
  UI->>V: "Look at the camera… Blink… Turn left…"
  UI->>API: POST /voters/register (details + ~29 frames)
  API->>DB: email/CNIC unique?
  API->>AI: POST /face/enrol (token, frames)
  AI-->>API: live? + 128-d embedding + nonce
  API->>DB: consume nonce (conditional update)
  API->>DB: decrypt all templates → 1:N cosine match
  alt duplicate face
    API->>DB: HIGH fraud alert, lock matched voter
    API-->>UI: 409 DUPLICATE_FACE
  else new person
    API->>DB: Voter (PENDING) + AES-GCM template + audit — one transaction
    API-->>UI: 201 PENDING
  end
```

## Sign-in and voting (replaces Fig 4.7)

```mermaid
sequenceDiagram
  actor V as Voter
  participant UI as React app
  participant D as Device authenticator
  participant API as Backend
  participant AI as AI service
  participant DB as MySQL

  V->>UI: CNIC
  UI->>API: POST /auth/voter/challenge
  API-->>UI: liveness challenge
  UI->>API: POST /auth/voter/face (CNIC, frames)
  API->>DB: voter APPROVED? decrypt template
  API->>AI: POST /face/verify (frames, template)
  AI-->>API: live + similarity
  API->>DB: AuthEvent → fraud rules
  API->>AI: POST /fraud/score (features)  — alert only
  API-->>UI: faceToken (5 min), next = WEBAUTHN_LOGIN
  UI->>API: POST /auth/voter/webauthn/options
  API-->>UI: challenge (stored, single use)
  UI->>D: navigator.credentials.get()
  D->>V: fingerprint / Face ID
  D-->>UI: signed assertion (user verified)
  UI->>API: POST /auth/voter/webauthn/verify
  API->>API: verify signature, origin, RP ID, UV, counter
  API-->>UI: access token + refresh cookie

  V->>UI: choose candidate → confirm
  UI->>API: POST /elections/:id/vote
  API->>DB: BEGIN, read election with shared lock, ACTIVE and inside window?
  API->>DB: INSERT Participation(voter, election)  ← primary key = one vote
  API->>DB: INSERT Ballot(random UUID, election, candidate)  — no voter, no time
  API->>DB: COMMIT
  API-->>UI: 201 { recorded: true }
```

## Data model (replaces Fig 4.2)

```mermaid
erDiagram
  Admin ||--o{ Election : creates
  Admin ||--o{ Candidate : adds
  Admin ||--o{ AdminOtp : "login codes"
  Voter ||--o| FaceTemplate : "encrypted embedding"
  Voter ||--o{ WebAuthnCredential : devices
  Voter ||--o{ Participation : "took part"
  Voter ||--o{ AuthEvent : attempts
  Voter |o--o{ FraudAlert : about
  Election ||--o{ Candidate : has
  Election ||--o{ Participation : ""
  Election ||--o{ Ballot : ""
  Election ||--o{ ResultTally : ""
  Candidate ||--o{ Ballot : "chosen in"
  Candidate ||--o{ ResultTally : ""

  Voter {
    uuid id PK
    string name
    string email UK
    string cnic UK
    enum status "PENDING APPROVED SUSPENDED LOCKED"
  }
  FaceTemplate {
    uuid voterId FK,UK
    bytes embeddingCiphertext "AES-256-GCM"
    bytes iv
    bytes authTag
    string modelVersion
  }
  WebAuthnCredential {
    string credentialId UK
    bytes publicKey
    int signCount
    datetime revokedAt
  }
  Election {
    uuid id PK
    string title
    datetime startsAt
    datetime endsAt
    enum status "DRAFT SCHEDULED ACTIVE CLOSED PUBLISHED"
    int eligibleAtClose
  }
  Participation {
    uuid voterId PK
    uuid electionId PK
    datetime votedAt
  }
  Ballot {
    uuid id PK "random v4"
    uuid electionId FK
    uuid candidateId FK
  }
  ResultTally {
    uuid electionId PK
    uuid candidateId PK
    int voteCount
  }
  AuditLog {
    int id PK
    string action
    json payload
    char prevHash
    char hash UK
  }
```

`Participation` and `Ballot` deliberately share no key and no timestamp. The proposal's single
`VOTE(voter_id, candidate_id, vote_time)` table would reveal how everyone voted (deviation D2).
Supporting tables not drawn: `AuditChainHead`, `SystemSetting`, `RefreshToken`,
`LivenessChallenge`, `WebAuthnChallenge`, `RecoveryRequest`.

## Election lifecycle

```mermaid
stateDiagram-v2
  [*] --> DRAFT: create
  DRAFT --> SCHEDULED: schedule (≥ 2 candidates)
  SCHEDULED --> ACTIVE: open
  ACTIVE --> CLOSED: close (tally computed)
  CLOSED --> PUBLISHED: publish
  note right of DRAFT: candidates editable in DRAFT and SCHEDULED
  note right of ACTIVE: votes accepted only here, inside startsAt..endsAt;\nadmins see turnout only
```

## Voter states (replaces Fig 4.9)

```mermaid
stateDiagram-v2
  [*] --> PENDING: register (face + liveness, unique face)
  PENDING --> APPROVED: admin approves
  PENDING --> SUSPENDED: admin suspends
  APPROVED --> SUSPENDED: admin suspends
  SUSPENDED --> APPROVED: admin approves
  APPROVED --> LOCKED: HIGH fraud alert (rules)
  PENDING --> LOCKED: HIGH fraud alert
  LOCKED --> APPROVED: admin reviews & approves
  LOCKED --> SUSPENDED: admin suspends
```

"Has voted" is not a voter state. It's a `Participation` row per election, so voting in one
election doesn't affect others.

## Deployment (replaces Fig 4.12)

```mermaid
flowchart TB
  subgraph Client
    B[Browser]
  end
  subgraph Host["Server (one machine for the FYP demo)"]
    P["Reverse proxy / static files<br/>HTTPS termination"]
    N["Backend :4000"]
    Y["AI service :8001<br/>(bound to localhost)"]
    M[("MySQL :3306<br/>(bound to localhost)")]
  end
  B -- HTTPS --> P
  P -- "/api" --> N
  N --> Y
  N --> M
```

In development, the Vite dev server plays the reverse proxy role. For phones, an HTTPS tunnel
fronts it (see [mobile-testing.md](mobile-testing.md)).

# Design decisions

Why the built system differs from the FYP proposal and documentation (`FYP Proposal.pdf`,
`finalzzzzz.pdf`), and the other choices made during the build. Each entry: what the documents
said, what we did, and why. Use this to defend the design at the viva.

## Deviations from the documentation

### D1. Fingerprint = WebAuthn on the voter's own device, not a scanner + templates
**Documents:** fingerprint scanner (SRS 2.2.5–2.2.6), `BIOMETRIC_DATA.fingerprint_template`
(Fig 4.2), training on SOCOFing.
**Built:** WebAuthn platform credential. The phone or laptop unlocks a private key with the
voter's fingerprint (or Face ID / screen lock), and the server stores only the public key.
**Why:** Web browsers cannot read fingerprint data, by design. A USB scanner would need a native
driver and agent on every machine, and the scope excludes native apps (§1.9). Matching SOCOFing
images would only work on uploaded pictures, not a live finger, so it would be a fake feature.
WebAuthn gives a cryptographically verifiable "this voter's registered device was unlocked by its
owner" factor. It also resists phishing: a signature for another website is refused, and that's
tested.

### D2. One vote table split into Participation and Ballot
**Documents:** `VOTE(vote_id, voter_id, election_id, candidate_id, vote_time)`.
**Built:** `Participation(voterId, electionId, votedAt)` and `Ballot(id, electionId, candidateId)`,
written in one transaction.
**Why:** a row holding both voter and candidate shows who voted for whom, contradicting
"maintain vote anonymity" (SRS 2.3.5). Ballots also have no timestamp and a random (UUIDv4) id,
because a time or a sequential id could be matched against `votedAt`.
**Residual risk:** MySQL's binary log records a transaction's rows together. See the security
review for the mitigation.

### D3. No voter passwords
**Documents:** `VOTER.password`; "voter enters login details" (UC-02).
**Built:** CNIC → live face → device fingerprint.
**Why:** the documentation itself says passwords "can be stolen, shared, or manipulated" (§1.1).
Two biometric-backed factors are both stronger and simpler for voters.

### D4. Results hidden while voting; turnout is real-time
**Documents:** real-time per-candidate counting and dashboards (SRS 2.3.7, UC-05 step 6).
**Built:** live turnout (refreshed every 10 seconds) while ACTIVE. Per-candidate results are
computed at close, checked by admins, and shown to voters only after publishing.
**Why:** live partial results influence the people still to vote, and with few voters they can
reveal individual choices. Real elections embargo results until polls close.
*Advisor sign-off requested* (brief Q1).

### D5. One-person-one-vote is a database constraint, not an AI check
**Documents:** UC-17, "AI engine detects multiple voting attempts".
**Built:** the `Participation` primary key, inside the vote transaction. A second attempt rolls
back and *then* raises a fraud alert.
**Why:** an ML model can't guarantee a hard rule, and an "already voted?" check in code has a race
condition. Tested: 10 simultaneous votes by one voter produce exactly one ballot.

### D6. Pretrained SFace instead of training on VGGFace2
**Built:** OpenCV Zoo SFace + YuNet, evaluated on LFW: FAR 0 %, FRR 2.6 % at threshold 0.363
([face-evaluation.md](face-evaluation.md)).
**Why:** training on 3.3 million VGGFace2 images isn't feasible for an FYP, and it wouldn't beat a
published model. Measuring the pretrained model is the honest alternative.

### D7. Fraud model trained on synthetic data
**Documents:** "Voter dataset (Kaggle/Generated)".
**Built:** a generated, labelled dataset with documented attack patterns
([fraud-detection.md](fraud-detection.md)).
**Why:** no public e-voting fraud dataset exists. Because the data is synthetic, the model can
only raise alerts, never block.

### D8. AES-256-GCM instead of "AES/RSA"
**Why:** TLS and WebAuthn already provide the public-key cryptography. GCM adds tamper detection,
and binding the voter id as authenticated data stops a template being copied to another voter.

### D9. Explicit voter status lifecycle
**Built:** `PENDING → APPROVED`, `SUSPENDED`, `LOCKED`. Only APPROVED voters can sign in or vote.
**Why:** it makes UC-10 and the voter state diagram (Fig 4.9) concrete and testable. `LOCKED` is
the automatic response to HIGH fraud alerts.

### D10. Hash-chained audit log instead of blockchain
**Documents:** optional blockchain in the proposal; out of scope in the documentation (§1.9).
**Built:** append-only `AuditLog` where each row stores the SHA-256 of the previous one, plus a
verify endpoint that pinpoints edits, deletions and truncation.
**Why:** it delivers the tamper-evidence goal without running a chain.

## Choices made during the build

| Decision | Choice | Why |
|---|---|---|
| Stack | React, Node.js + Express, MySQL, Python/OpenCV/scikit-learn, as documented; TypeScript on top of JavaScript | Matches the documents; TypeScript catches errors at build time and compiles to JavaScript |
| Python version | 3.12 | Installed on the development machine; all libraries support it |
| Admin second factor | Email OTP (6 digits, 5 min, 5 attempts, single use) | Fig 4.1 lists "OTP verification"; it protects the most powerful accounts |
| Device hash | SHA-256(random device cookie + user agent) | Lets fraud rules see one device used for many CNICs without fingerprinting the browser |
| Liveness | Server-issued, HMAC-signed, single-use challenge: blink + head turn in random order, checked on ~29 frames with MediaPipe | A photo can't blink; a random order defeats pre-recorded videos; single use defeats replays |
| Identity consistency | Every frame of a capture must show the same person (pairwise similarity) | Stops swapping a live accomplice and a photo mid-capture |
| Face step token | Separate short JWT (5 min, own audience) between the face and device steps | It can't be mistaken for a session token, and the session exists only after both factors |
| Tally timing | Computed inside the close transaction that holds the election row lock | Votes in flight finish first and none can land after, so the count is complete |
| Rate limiting | Per account when signed in, per IP otherwise | One campus or mobile IP is shared by hundreds of voters (found by the load test) |
| Results chart | Recharts, single hue, lazy-loaded, always paired with a table | The table is the accessible data; the voter bundle stays ~95 KB gzipped |
| Eligibility | All APPROVED voters are eligible for every election | Documented assumption (brief §5.9); one position per election, single choice |
| Lost device | Face-verified request → admin approval revokes old credentials → voter enrols the new device | No self-service bypass of the second factor |

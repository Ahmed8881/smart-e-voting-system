"""Liveness: randomised challenges and the pure decision logic over per-frame signals.

Kept free of OpenCV/MediaPipe so it can be unit-tested with synthetic signal sequences.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from enum import StrEnum


class Action(StrEnum):
    BLINK = "BLINK"
    TURN_LEFT = "TURN_LEFT"  # the user's own left
    TURN_RIGHT = "TURN_RIGHT"


CHALLENGE_TTL_SECONDS = 120

# Blendshape scores (0..1). Open eyes measured 0.0-0.27 on test photos; a real blink is > 0.5.
EYES_OPEN_MAX = 0.35
EYES_CLOSED_MIN = 0.5
# Head yaw in degrees from the raw (un-mirrored) camera frame; positive = user turned to their left.
FRONTAL_MAX_DEG = 12.0
TURN_MIN_DEG = 20.0
MIN_FRAMES = 6
MAX_UNTRACKED_RATIO = 0.2


@dataclass(frozen=True)
class Challenge:
    nonce: str
    actions: list[Action]
    expires_at: int


class ChallengeError(ValueError):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: bytes, body: str) -> str:
    return _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())


def issue_challenge(secret: bytes, now: float | None = None) -> tuple[str, Challenge]:
    """A blink (photos can't blink) plus one head turn, in random order."""
    rng = secrets.SystemRandom()
    actions = [Action.BLINK, rng.choice([Action.TURN_LEFT, Action.TURN_RIGHT])]
    rng.shuffle(actions)
    challenge = Challenge(
        nonce=secrets.token_urlsafe(16),
        actions=actions,
        expires_at=int((now or time.time()) + CHALLENGE_TTL_SECONDS),
    )
    body = _b64(
        json.dumps(
            {"n": challenge.nonce, "a": [a.value for a in actions], "e": challenge.expires_at}
        ).encode()
    )
    return f"{body}.{_sign(secret, body)}", challenge


def parse_challenge(secret: bytes, token: str, now: float | None = None) -> Challenge:
    """Verifies signature and expiry. Single use is enforced by the backend (it records nonces)."""
    try:
        body, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(secret, body)):
            raise ChallengeError("bad signature")
        data = json.loads(_unb64(body))
        challenge = Challenge(
            nonce=str(data["n"]),
            actions=[Action(a) for a in data["a"]],
            expires_at=int(data["e"]),
        )
    except ChallengeError:
        raise
    except (ValueError, KeyError, TypeError) as exc:
        raise ChallengeError("malformed challenge") from exc
    if challenge.expires_at < (now or time.time()):
        raise ChallengeError("challenge expired")
    return challenge


@dataclass(frozen=True)
class FrameSignals:
    """What the landmarker saw in one frame. blink/yaw are None when no single face was tracked."""

    faces: int
    blink: float | None = None  # min(left, right) — both eyes must close, a wink doesn't count
    yaw: float | None = None


@dataclass(frozen=True)
class LivenessResult:
    live: bool
    reason: str | None
    completed: list[Action]


def evaluate(actions: list[Action], frames: list[FrameSignals]) -> LivenessResult:
    """The actions must be performed in order across the frame sequence."""
    if len(frames) < MIN_FRAMES:
        return LivenessResult(False, "TOO_FEW_FRAMES", [])
    if any(f.faces > 1 for f in frames):
        return LivenessResult(False, "MULTIPLE_FACES", [])
    tracked = [
        (f.blink, f.yaw)
        for f in frames
        if f.faces == 1 and f.blink is not None and f.yaw is not None
    ]
    if len(frames) - len(tracked) > MAX_UNTRACKED_RATIO * len(frames):
        return LivenessResult(False, "FACE_NOT_TRACKED", [])

    completed: list[Action] = []
    position = 0
    for action in actions:
        found = (
            _find_blink(tracked, position)
            if action == Action.BLINK
            else _find_turn(tracked, position, action)
        )
        if found is None:
            return LivenessResult(False, f"ACTION_NOT_DETECTED:{action.value}", completed)
        completed.append(action)
        position = found
    return LivenessResult(True, None, completed)


def _find_blink(frames: list[tuple[float, float]], start: int) -> int | None:
    """Open → closed → open. Returns the index of the re-opened frame."""
    state = "want_open"
    for i in range(start, len(frames)):
        blink = frames[i][0]
        if state == "want_open" and blink <= EYES_OPEN_MAX:
            state = "want_closed"
        elif state == "want_closed" and blink >= EYES_CLOSED_MIN:
            state = "want_reopen"
        elif state == "want_reopen" and blink <= EYES_OPEN_MAX:
            return i
    return None


def _find_turn(frames: list[tuple[float, float]], start: int, action: Action) -> int | None:
    """Frontal first, then turned far enough the right way — proves movement, not a tilted photo."""
    sign = 1 if action == Action.TURN_LEFT else -1
    seen_frontal = False
    for i in range(start, len(frames)):
        yaw = frames[i][1]
        if abs(yaw) <= FRONTAL_MAX_DEG:
            seen_frontal = True
        elif seen_frontal and sign * yaw >= TURN_MIN_DEG:
            return i
    return None

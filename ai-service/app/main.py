"""Internal face-recognition and fraud-scoring service. Only the backend calls this.

Every endpoint except /health requires the shared X-Service-Token header.
"""

import base64
import binascii
import hashlib
import hmac
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import cv2
import numpy as np
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.face_engine import MODEL_VERSION, FaceEngine
from app.liveness import ChallengeError, evaluate, issue_challenge, parse_challenge

MAX_FRAMES = 30
MAX_FRAME_B64 = 700_000  # ~500 KB JPEG
MAX_FRAME_SIDE = 1920
# Frames of one capture must all show the same person (stops swapping in a photo mid-challenge).
IDENTITY_CONSISTENCY_MIN = 0.3
MIN_EMBEDDED_FRAMES = 3

app = FastAPI(title="E-Voting AI Service", docs_url=None, redoc_url=None, openapi_url=None)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(ApiError)
def _api_error(_: Request, exc: ApiError):
    return error_response(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
def _validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", [])[1:])
    return error_response(400, "VALIDATION_ERROR", f"{where}: {first.get('msg', 'invalid input')}")


@lru_cache
def service_token() -> str:
    token = os.environ.get("AI_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("AI_SERVICE_TOKEN must be set (at least 32 characters)")
    return token


def challenge_secret() -> bytes:
    # Derived from the service token so there's one secret to manage, but never the same bytes.
    return hashlib.sha256(b"liveness-challenge:" + service_token().encode()).digest()


@lru_cache
def engine() -> FaceEngine:
    models_dir = Path(os.environ.get("MODELS_DIR", Path(__file__).parent.parent / "models"))
    return FaceEngine(models_dir)


def require_service_token(x_service_token: Annotated[str | None, Header()] = None) -> None:
    if not x_service_token or not hmac.compare_digest(x_service_token, service_token()):
        raise ApiError(401, "UNAUTHENTICATED", "Missing or invalid service token")


Authed = Depends(require_service_token)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


@app.post("/liveness/challenge", dependencies=[Authed])
def new_challenge():
    token, challenge = issue_challenge(challenge_secret())
    return {
        "token": token,
        "nonce": challenge.nonce,
        "actions": challenge.actions,
        "expiresAt": challenge.expires_at,
    }


class CaptureRequest(BaseModel):
    challengeToken: str = Field(max_length=1000)
    frames: list[Annotated[str, Field(max_length=MAX_FRAME_B64)]] = Field(
        min_length=1, max_length=MAX_FRAMES
    )


class VerifyRequest(CaptureRequest):
    referenceEmbedding: str = Field(max_length=2000)


def decode_frame(data: str, index: int) -> np.ndarray:
    try:
        raw = base64.b64decode(data.split(",", 1)[-1], validate=True)  # tolerate data: URLs
    except binascii.Error as exc:
        raise ApiError(400, "INVALID_FRAME", f"frames.{index}: not valid base64") from exc
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ApiError(400, "INVALID_FRAME", f"frames.{index}: not a decodable image")
    if max(image.shape[:2]) > MAX_FRAME_SIDE:
        raise ApiError(400, "INVALID_FRAME", f"frames.{index}: larger than {MAX_FRAME_SIDE}px")
    return image


def encode_embedding(embedding: np.ndarray) -> str:
    return base64.b64encode(embedding.astype("<f4").tobytes()).decode()


def decode_embedding(data: str) -> np.ndarray:
    try:
        vector = np.frombuffer(base64.b64decode(data, validate=True), dtype="<f4")
    except (binascii.Error, ValueError) as exc:
        raise ApiError(400, "INVALID_EMBEDDING", "referenceEmbedding is not valid base64") from exc
    if vector.shape != (128,) or not np.isfinite(vector).all() or np.linalg.norm(vector) == 0:
        raise ApiError(400, "INVALID_EMBEDDING", "referenceEmbedding must be 128 float32 values")
    return vector / np.linalg.norm(vector)


def analyse_capture(req: CaptureRequest) -> dict:
    """Liveness + identity consistency over one capture. Embedding is returned only if live."""
    try:
        challenge = parse_challenge(challenge_secret(), req.challengeToken)
    except ChallengeError as exc:
        raise ApiError(400, "CHALLENGE_INVALID", str(exc)) from exc

    analyses = [engine().analyze(decode_frame(f, i)) for i, f in enumerate(req.frames)]
    base = {"nonce": challenge.nonce, "modelVersion": MODEL_VERSION, "frameCount": len(analyses)}

    embeddings = [a.embedding for a in analyses if a.embedding is not None]
    if len(embeddings) < MIN_EMBEDDED_FRAMES:
        return {**base, "live": False, "reason": "FACE_NOT_CLEAR", "embedding": None}
    # Pairwise, not against the mean: a 50/50 mix of two people would sit close to their average.
    stacked = np.stack(embeddings)
    if float((stacked @ stacked.T).min()) < IDENTITY_CONSISTENCY_MIN:
        return {**base, "live": False, "reason": "IDENTITY_CHANGED", "embedding": None}
    mean = stacked.mean(axis=0)
    mean /= np.linalg.norm(mean)

    liveness = evaluate(challenge.actions, [a.signals for a in analyses])
    return {
        **base,
        "live": liveness.live,
        "reason": liveness.reason,
        "embedding": encode_embedding(mean) if liveness.live else None,
    }


@app.post("/face/enrol", dependencies=[Authed])
def enrol(req: CaptureRequest):
    """Liveness-challenge frames → averaged 128-d embedding (plaintext; the backend encrypts it)."""
    return analyse_capture(req)


@app.post("/face/verify", dependencies=[Authed])
def verify(req: VerifyRequest):
    """Same checks as enrol, plus cosine similarity to the stored embedding.

    The match threshold lives in the backend's system settings, so the backend makes the decision.
    """
    reference = decode_embedding(req.referenceEmbedding)
    result = analyse_capture(req)
    probe = result.pop("embedding")  # the backend needs only the score, not the probe vector
    similarity = None if probe is None else round(float(decode_embedding(probe) @ reference), 4)
    return {**result, "similarity": similarity}

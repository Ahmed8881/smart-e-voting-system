"""Hostile payloads must give 4xx in the standard error shape, never a 500 (Phase 9)."""

import base64
import os
import random

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.liveness import issue_challenge
from app.main import app, challenge_secret

client = TestClient(app, raise_server_exceptions=False)
AUTH = {"X-Service-Token": os.environ["AI_SERVICE_TOKEN"]}

NASTY = [
    None,
    True,
    -1,
    1e308,
    "",
    "x" * 5000,
    "%%%",
    "data:image/png;base64,AAAA",
    [],
    {},
    {"__proto__": 1},
    [None, "a"],
]


def random_value(r: random.Random):
    return r.choice(NASTY)


def corrupt_jpeg(r: random.Random) -> str:
    """A real JPEG with random bytes flipped or truncated — the decoder must not crash."""
    image = np.full((120, 120, 3), r.randint(0, 255), np.uint8)
    raw = bytearray(cv2.imencode(".jpg", image)[1].tobytes())
    for _ in range(r.randint(1, 30)):
        raw[r.randrange(len(raw))] = r.randrange(256)
    if r.random() < 0.3:
        raw = raw[: r.randrange(1, len(raw))]
    return base64.b64encode(bytes(raw)).decode()


@pytest.mark.parametrize("path", ["/face/enrol", "/face/verify", "/fraud/score"])
def test_random_bodies(path):
    r = random.Random(path)
    fields = ["challengeToken", "frames", "referenceEmbedding", "hour_of_day", "face_similarity"]
    for _ in range(60):
        body = {f: random_value(r) for f in fields if r.random() < 0.7}
        res = client.post(path, headers=AUTH, json=body if r.random() > 0.1 else random_value(r))
        assert 400 <= res.status_code < 500, (res.status_code, body)
        assert set(res.json()["error"]) == {"code", "message"}


@pytest.mark.usefixtures("models_available")
def test_corrupted_images_never_crash_the_service():
    r = random.Random(7)
    for _ in range(25):
        token = issue_challenge(challenge_secret())[0]
        frames = [corrupt_jpeg(r) for _ in range(6)]
        res = client.post(
            "/face/enrol", headers=AUTH, json={"challengeToken": token, "frames": frames}
        )
        assert res.status_code in (200, 400), res.text
        if res.status_code == 200:
            assert res.json()["live"] is False

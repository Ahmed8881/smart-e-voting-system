import base64
import os

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.liveness import issue_challenge
from app.main import app, challenge_secret, engine
from tests.conftest import load, to_b64

pytestmark = pytest.mark.usefixtures("models_available")

client = TestClient(app)
AUTH = {"X-Service-Token": os.environ["AI_SERVICE_TOKEN"]}
SFACE_THRESHOLD = 0.363


def embed(image: np.ndarray) -> np.ndarray:
    result = engine().analyze(image).embedding
    assert result is not None
    return result


def challenge_token() -> str:
    return issue_challenge(challenge_secret())[0]


def enrol(frames: list[np.ndarray], token: str | None = None):
    return client.post(
        "/face/enrol",
        headers=AUTH,
        json={"challengeToken": token or challenge_token(), "frames": [to_b64(f) for f in frames]},
    )


def photo_of_a_photo(image: np.ndarray, seed: int) -> np.ndarray:
    """Simulates holding a printed photo up to the webcam: paper border, slight hand-held
    perspective that changes per frame, print grain, lens blur, lighting and re-compression."""
    rng = np.random.default_rng(seed)
    paper = cv2.copyMakeBorder(image, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=(235, 235, 235))
    h, w = paper.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jitter = rng.uniform(-0.04, 0.04, size=(4, 2)) * [w, h]
    dst = (src + jitter).astype(np.float32)
    canvas = cv2.warpPerspective(
        paper, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(60, 50, 40)
    )
    canvas = canvas.astype(np.float32) * rng.uniform(0.85, 1.1)  # lighting
    canvas += rng.normal(0, 6, canvas.shape)  # print grain / sensor noise
    canvas = cv2.GaussianBlur(np.clip(canvas, 0, 255).astype(np.uint8), (3, 3), 0)
    ok, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 70])
    assert ok
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


class TestRecognition:
    def test_same_person_different_photos_match(self):
        assert float(embed(load("obama.jpg")) @ embed(load("obama2.jpg"))) > SFACE_THRESHOLD

    @pytest.mark.parametrize("other", ["biden.jpg", "astronaut.jpg"])
    def test_different_people_do_not_match(self, other):
        assert float(embed(load("obama.jpg")) @ embed(load(other))) < SFACE_THRESHOLD

    def test_embedding_is_unit_length_128d(self):
        e = embed(load("astronaut.jpg"))
        assert e.shape == (128,)
        assert abs(float(np.linalg.norm(e)) - 1) < 1e-5


class TestAuth:
    def test_health_is_open(self):
        assert client.get("/health").status_code == 200

    @pytest.mark.parametrize("headers", [{}, {"X-Service-Token": "wrong"}])
    def test_endpoints_require_the_service_token(self, headers):
        res = client.post("/liveness/challenge", headers=headers)
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHENTICATED"


class TestChallengeEndpoint:
    def test_issues_blink_plus_turn(self):
        body = client.post("/liveness/challenge", headers=AUTH).json()
        assert "BLINK" in body["actions"] and len(body["actions"]) == 2
        assert body["token"] and body["nonce"] and body["expiresAt"]


class TestEnrolSpoofing:
    def test_static_photo_fails_liveness_and_returns_no_embedding(self):
        res = enrol([load("obama.jpg")] * 8)
        assert res.status_code == 200
        body = res.json()
        assert body["live"] is False
        assert body["reason"].startswith("ACTION_NOT_DETECTED")
        assert body["embedding"] is None

    def test_photo_of_a_photo_is_recognised_but_fails_liveness(self):
        frames = [photo_of_a_photo(load("obama.jpg"), seed) for seed in range(8)]
        # The attack is realistic: the re-photographed print still matches the real person...
        assert float(embed(frames[0]) @ embed(load("obama2.jpg"))) > SFACE_THRESHOLD
        # ...but it cannot blink or turn its head on command.
        body = enrol(frames).json()
        assert body["live"] is False
        assert body["reason"].startswith("ACTION_NOT_DETECTED")
        assert body["embedding"] is None

    def test_swapping_people_mid_capture_is_rejected(self):
        frames = [load("obama.jpg"), load("biden.jpg")] * 4
        assert enrol(frames).json()["reason"] == "IDENTITY_CHANGED"

    def test_no_face_is_rejected(self):
        blank = np.full((360, 360, 3), 128, np.uint8)
        assert enrol([blank] * 8).json()["reason"] == "FACE_NOT_CLEAR"

    def test_response_carries_the_nonce_for_single_use_enforcement(self):
        token, challenge = issue_challenge(challenge_secret())
        assert enrol([load("obama.jpg")] * 8, token).json()["nonce"] == challenge.nonce


class TestInputValidation:
    def test_invalid_challenge_token(self):
        res = enrol([load("obama.jpg")] * 6, token="forged.token")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "CHALLENGE_INVALID"

    def test_expired_challenge_token(self):
        token, _ = issue_challenge(challenge_secret(), now=1_000_000)
        res = enrol([load("obama.jpg")] * 6, token=token)
        assert res.json()["error"] == {"code": "CHALLENGE_INVALID", "message": "challenge expired"}

    @pytest.mark.parametrize(
        ("frame", "message"),
        [
            ("%%%not-base64", "not valid base64"),
            (base64.b64encode(b"hello").decode(), "not a decodable image"),
        ],
    )
    def test_bad_frames(self, frame, message):
        res = client.post(
            "/face/enrol",
            headers=AUTH,
            json={"challengeToken": challenge_token(), "frames": [frame]},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "INVALID_FRAME"
        assert message in res.json()["error"]["message"]

    def test_too_many_frames(self):
        res = client.post(
            "/face/enrol",
            headers=AUTH,
            json={"challengeToken": challenge_token(), "frames": ["x"] * 31},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"


class TestVerify:
    def reference(self) -> str:
        return base64.b64encode(embed(load("obama2.jpg")).astype("<f4").tobytes()).decode()

    def test_spoofed_capture_gives_no_similarity(self):
        res = client.post(
            "/face/verify",
            headers=AUTH,
            json={
                "challengeToken": challenge_token(),
                "frames": [to_b64(load("obama.jpg"))] * 8,
                "referenceEmbedding": self.reference(),
            },
        )
        body = res.json()
        assert body["live"] is False
        assert body["similarity"] is None
        assert "embedding" not in body

    @pytest.mark.parametrize("ref", ["%%%", base64.b64encode(b"\x00" * 16).decode()])
    def test_invalid_reference_embedding(self, ref):
        res = client.post(
            "/face/verify",
            headers=AUTH,
            json={"challengeToken": challenge_token(), "frames": ["x"], "referenceEmbedding": ref},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "INVALID_EMBEDDING"

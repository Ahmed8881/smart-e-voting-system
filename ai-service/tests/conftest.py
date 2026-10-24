import base64
import os
from pathlib import Path

import cv2
import numpy as np
import pytest

os.environ.setdefault("AI_SERVICE_TOKEN", "test-service-token-" + "x" * 20)

FIXTURES = Path(__file__).parent / "fixtures"
MODELS = Path(__file__).parent.parent / "models"


def load(name: str) -> np.ndarray:
    image = cv2.imread(str(FIXTURES / name))
    assert image is not None, name
    return image


def to_b64(image: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


@pytest.fixture(scope="session")
def models_available():
    if not (MODELS / "face_recognition_sface_2021dec.onnx").exists():
        pytest.skip("models not downloaded — run: python scripts/download_models.py")

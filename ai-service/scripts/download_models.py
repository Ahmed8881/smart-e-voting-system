"""Downloads the pretrained models into ai-service/models/ and verifies their SHA-256.

Run once after `pip install`:  python scripts/download_models.py
Safe to re-run: files that already match their checksum are skipped.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

MODELS = {
    # OpenCV Zoo, Apache-2.0 — face detection with 5 landmarks (used for SFace alignment)
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    # OpenCV Zoo, Apache-2.0 — 128-d face embeddings
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
    # Google MediaPipe, Apache-2.0 — 478 landmarks + blendshapes + head pose (liveness)
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    ),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    MODELS_DIR.mkdir(exist_ok=True)
    for name, (url, expected) in MODELS.items():
        path = MODELS_DIR / name
        if path.exists() and sha256(path) == expected:
            print(f"ok       {name}")
            continue
        print(f"download {name}")
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)  # noqa: S310 — fixed https URLs above
        actual = sha256(tmp)
        if actual != expected:
            tmp.unlink()
            print(f"CHECKSUM MISMATCH for {name}: got {actual}", file=sys.stderr)
            return 1
        tmp.replace(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())

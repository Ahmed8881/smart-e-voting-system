"""Models: YuNet (detect + align), SFace (embed), MediaPipe FaceLandmarker (liveness)."""

import math
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from app.liveness import FrameSignals

MODEL_VERSION = "sface_2021dec"
MIN_FACE_PX = 80


@dataclass(frozen=True)
class FrameAnalysis:
    signals: FrameSignals
    embedding: np.ndarray | None  # unit-length float32[128], only when exactly one usable face


class FaceEngine:
    def __init__(self, models_dir: Path):
        missing = [
            name
            for name in (
                "face_detection_yunet_2023mar.onnx",
                "face_recognition_sface_2021dec.onnx",
                "face_landmarker.task",
            )
            if not (models_dir / name).exists()
        ]
        if missing:
            raise FileNotFoundError(
                f"Missing models {missing} — run: python scripts/download_models.py"
            )
        self._detector = cv2.FaceDetectorYN.create(
            str(models_dir / "face_detection_yunet_2023mar.onnx"), "", (0, 0), 0.8
        )
        self._recognizer = cv2.FaceRecognizerSF.create(
            str(models_dir / "face_recognition_sface_2021dec.onnx"), ""
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(models_dir / "face_landmarker.task")),
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=2,  # so a second face in frame is detected and rejected
            )
        )
        # shortcut: the models aren't thread-safe, so frames are analysed one at a time per
        # process; scale with more uvicorn workers if registration traffic needs it.
        self._lock = threading.Lock()

    def analyze(self, image: np.ndarray) -> FrameAnalysis:
        with self._lock:
            return FrameAnalysis(self._landmark_signals(image), self._embed(image))

    def embed_largest_face(self, image: np.ndarray) -> np.ndarray | None:
        """Benchmark protocol (LFW photos often have bystanders): embed the biggest face.
        Never used for voters, where a second face in frame is a rejection."""
        with self._lock:
            return self._embed(image, single_face_only=False)

    def _embed(self, image: np.ndarray, single_face_only: bool = True) -> np.ndarray | None:
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        faces = self._detector.detect(image)[1]
        if faces is None or (single_face_only and len(faces) != 1):
            return None
        face = max(faces, key=lambda f: f[2] * f[3])
        if min(face[2], face[3]) < MIN_FACE_PX:
            return None
        feature = self._recognizer.feature(self._recognizer.alignCrop(image, face)).flatten()
        return (feature / np.linalg.norm(feature)).astype(np.float32)

    def _landmark_signals(self, image: np.ndarray) -> FrameSignals:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = self._landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        faces = len(result.face_landmarks)
        if faces != 1:
            return FrameSignals(faces=faces)
        scores = {c.category_name: c.score for c in result.face_blendshapes[0]}
        matrix = np.array(result.facial_transformation_matrixes[0])
        # Yaw from the head-pose rotation. Verified on still photos and their mirror images:
        # positive when the face points to the image's right = the user's own left in an
        # un-mirrored camera frame. Re-check with a live webcam when the capture UI is built.
        yaw = math.degrees(math.atan2(matrix[0, 2], matrix[2, 2]))
        return FrameSignals(
            faces=1,
            blink=min(scores["eyeBlinkLeft"], scores["eyeBlinkRight"]),
            yaw=yaw,
        )

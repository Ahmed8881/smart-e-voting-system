"""Login anomaly scoring with an Isolation Forest (UC-15 Analyze Activities, UC-16).

The model is trained on SYNTHETIC data (scripts/generate_synthetic.py) because no real e-voting
fraud dataset exists. It only ever raises alerts; it never blocks a voter.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

FEATURES = [
    "hour_of_day",  # 0-23, server local time
    "failed_attempts_last_hour",  # failed face/device checks for this CNIC
    "new_device",  # 1 if this device hash never signed this voter in before
    "new_ip",  # 1 if this IP never signed this voter in before
    "accounts_on_device_24h",  # distinct CNICs tried from this device in 24 h
    "days_since_registration",
    "face_similarity",  # cosine similarity of the login face to the enrolled template
]

# decision_function is ~[-0.3, 0.3], negative = outlier. A steep sigmoid maps it to a 0..1 score
# where 0.5 is the model's own boundary, so the admin-facing threshold reads as "how sure".
SCORE_STEEPNESS = 20.0


def to_score(decision: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(SCORE_STEEPNESS * decision))


@dataclass
class AnomalyModel:
    model: object
    version: str

    def score(self, features: dict[str, float]) -> float:
        row = np.array([[features[name] for name in FEATURES]], dtype=float)
        return float(to_score(self.model.decision_function(row))[0])  # type: ignore[attr-defined]


def model_paths(models_dir: Path) -> tuple[Path, Path]:
    return models_dir / "anomaly.joblib", models_dir / "anomaly.json"


def load_model(models_dir: Path) -> AnomalyModel | None:
    model_file, meta_file = model_paths(models_dir)
    if not model_file.exists() or not meta_file.exists():
        return None
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    if meta.get("features") != FEATURES:
        raise RuntimeError("Anomaly model was trained on different features — retrain it")
    return AnomalyModel(model=joblib.load(model_file), version=str(meta["version"]))


def is_finite(value: float) -> bool:
    return not (math.isnan(value) or math.isinf(value))

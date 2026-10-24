"""Generates a labelled SYNTHETIC login dataset, trains the Isolation Forest, reports
precision/recall on a held-out split, and saves the model with a version.

    python scripts/generate_synthetic.py [--samples 20000] [--anomaly-rate 0.05] [--seed 42]

Why synthetic: there is no public dataset of e-voting login fraud. The normal behaviour and the
injected attack patterns below are assumptions, written down so they can be challenged. Results
measure how well the model separates *these* patterns — not real-world fraud detection accuracy.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_score, recall_score
from sklearn.model_selection import train_test_split

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.anomaly import FEATURES, model_paths, to_score  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ALERT_THRESHOLD = 0.6  # matches the backend default setting fraud.anomalyThreshold


def normal_logins(rng: np.random.Generator, n: int) -> np.ndarray:
    """Typical voter: daytime, own device, no failures, enrolled a while ago, clear face match."""
    hour = np.clip(rng.normal(14, 3.5, n), 6, 23).round()
    failed = rng.choice([0, 1], n, p=[0.92, 0.08])
    new_device = rng.random(n) < 0.05
    new_ip = rng.random(n) < 0.15
    accounts = rng.choice([1, 2], n, p=[0.97, 0.03])  # family sharing a phone
    days = rng.uniform(1, 365, n).round()
    similarity = np.clip(rng.normal(0.72, 0.08, n), 0.37, 0.95)
    return np.column_stack([hour, failed, new_device, new_ip, accounts, days, similarity])


def anomalous_logins(rng: np.random.Generator, n: int) -> np.ndarray:
    """Five attack patterns, mixed. Each is a hypothesis about what fraud looks like."""
    rows = normal_logins(rng, n)
    pattern = rng.integers(0, 5, n)
    for i, p in enumerate(pattern):
        if p == 0:  # brute force: many failures, often at night
            rows[i, 1] = rng.integers(3, 12)
            rows[i, 0] = rng.choice([1, 2, 3, 4, rows[i, 0]])
        elif p == 1:  # one device cycling through many identities
            rows[i, 4] = rng.integers(3, 15)
            rows[i, 2] = 1
        elif p == 2:  # look-alike / poor spoof that barely clears the face threshold
            rows[i, 6] = rng.uniform(0.36, 0.45)
            rows[i, 1] = rng.integers(1, 4)
        elif p == 3:  # freshly registered account used at once from a new device and network
            rows[i, 5] = rng.integers(0, 2)
            rows[i, 2] = rows[i, 3] = 1
            rows[i, 0] = rng.integers(0, 5)
        else:  # stolen device taken somewhere new at night
            rows[i, 2] = rows[i, 3] = 1
            rows[i, 0] = rng.integers(0, 5)
            rows[i, 1] = rng.integers(1, 4)
    return rows


def build_dataset(samples: int, anomaly_rate: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    n_anomalies = int(samples * anomaly_rate)
    x = np.vstack([normal_logins(rng, samples - n_anomalies), anomalous_logins(rng, n_anomalies)])
    y = np.concatenate([np.zeros(samples - n_anomalies), np.ones(n_anomalies)])
    order = rng.permutation(len(y))
    return x[order], y[order]


def train(x: np.ndarray, contamination: float, seed: int) -> IsolationForest:
    return IsolationForest(n_estimators=200, contamination=contamination, random_state=seed).fit(x)


def evaluate(model: IsolationForest, x: np.ndarray, y: np.ndarray, threshold: float) -> dict:
    predicted = to_score(model.decision_function(x)) >= threshold
    return {
        "threshold": threshold,
        "precision": round(float(precision_score(y, predicted, zero_division=0)), 4),
        "recall": round(float(recall_score(y, predicted, zero_division=0)), 4),
        "alerts_raised": int(predicted.sum()),
        "true_anomalies": int(y.sum()),
        "test_size": len(y),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=20_000)
    parser.add_argument("--anomaly-rate", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    x, y = build_dataset(args.samples, args.anomaly_rate, args.seed)
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.25, random_state=args.seed, stratify=y
    )
    # Unsupervised: the labels are used only to evaluate, never to fit.
    model = train(x_train, contamination=args.anomaly_rate, seed=args.seed)

    metrics = {
        f"at_{t}": evaluate(model, x_test, y_test, t) for t in (0.5, ALERT_THRESHOLD, 0.7, 0.8)
    }
    version = datetime.now(UTC).strftime("%Y%m%d%H%M%S")

    MODELS_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    np.savetxt(
        DATA_DIR / "synthetic_logins.csv",
        np.column_stack([x, y]),
        delimiter=",",
        header=",".join([*FEATURES, "is_anomaly"]),
        comments="",
        fmt="%g",
    )
    model_file, meta_file = model_paths(MODELS_DIR)
    joblib.dump(model, model_file)
    meta_file.write_text(
        json.dumps(
            {
                "version": version,
                "trained_on": "SYNTHETIC data (scripts/generate_synthetic.py) — not real fraud",
                "features": FEATURES,
                "samples": args.samples,
                "anomaly_rate": args.anomaly_rate,
                "seed": args.seed,
                "metrics_held_out": metrics,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"model version {version} saved to {model_file}")
    print("held-out evaluation (synthetic):")
    for name, m in metrics.items():
        print(
            f"  {name:7}  precision {m['precision']:.1%}  recall {m['recall']:.1%}"
            f"  ({m['alerts_raised']} alerts, {m['true_anomalies']} true anomalies"
            f" in {m['test_size']})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

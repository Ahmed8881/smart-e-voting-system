import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.anomaly import FEATURES, AnomalyModel
from scripts.generate_synthetic import build_dataset, evaluate, train

AUTH = {"X-Service-Token": os.environ["AI_SERVICE_TOKEN"]}
client = TestClient(main.app)

NORMAL = {
    "hour_of_day": 14,
    "failed_attempts_last_hour": 0,
    "new_device": False,
    "new_ip": False,
    "accounts_on_device_24h": 1,
    "days_since_registration": 120,
    "face_similarity": 0.74,
}
SUSPICIOUS = {
    "hour_of_day": 3,
    "failed_attempts_last_hour": 8,
    "new_device": True,
    "new_ip": True,
    "accounts_on_device_24h": 9,
    "days_since_registration": 0,
    "face_similarity": 0.38,
}


@pytest.fixture(scope="module")
def small_model():
    x, y = build_dataset(4000, 0.05, seed=7)
    return train(x, contamination=0.05, seed=7), x, y


def test_dataset_is_labelled_with_the_requested_anomaly_rate():
    x, y = build_dataset(1000, 0.1, seed=1)
    assert x.shape == (1000, len(FEATURES))
    assert int(y.sum()) == 100


def test_dataset_is_reproducible():
    a, _ = build_dataset(200, 0.05, seed=3)
    b, _ = build_dataset(200, 0.05, seed=3)
    assert np.array_equal(a, b)


def test_model_separates_the_injected_patterns(small_model):
    model, x, y = small_model
    metrics = evaluate(model, x, y, threshold=0.6)
    assert metrics["precision"] > 0.7
    assert metrics["recall"] > 0.5


@pytest.fixture
def with_model(small_model, monkeypatch):
    model = AnomalyModel(model=small_model[0], version="test")
    monkeypatch.setattr(main, "anomaly_model", lambda: model)


def test_suspicious_login_scores_higher_than_a_normal_one(with_model):
    normal = client.post("/fraud/score", headers=AUTH, json=NORMAL).json()
    suspicious = client.post("/fraud/score", headers=AUTH, json=SUSPICIOUS).json()
    assert normal["modelVersion"] == "test"
    assert normal["score"] < 0.5 < suspicious["score"]


def test_requires_the_service_token(with_model):
    assert client.post("/fraud/score", json=NORMAL).status_code == 401


@pytest.mark.parametrize(
    ("field", "value"),
    [("hour_of_day", 24), ("face_similarity", 2), ("failed_attempts_last_hour", -1)],
)
def test_out_of_range_features_are_rejected(with_model, field, value):
    res = client.post("/fraud/score", headers=AUTH, json={**NORMAL, field: value})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_untrained_model_gives_503(monkeypatch):
    monkeypatch.setattr(main, "anomaly_model", lambda: None)
    res = client.post("/fraud/score", headers=AUTH, json=NORMAL)
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "MODEL_NOT_TRAINED"

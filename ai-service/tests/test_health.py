from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "ai-service"}


def test_api_docs_are_not_exposed():
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404

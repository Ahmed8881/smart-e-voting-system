"""Internal face-recognition and fraud-scoring service. Only the backend calls this."""

from fastapi import FastAPI

app = FastAPI(title="E-Voting AI Service", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}

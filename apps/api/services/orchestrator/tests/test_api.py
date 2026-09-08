import httpx
import pytest

from services.orchestrator.src.main import app


@pytest.mark.asyncio
async def test_liveness_does_not_leak_configuration():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "key" not in response.text.lower()
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
async def test_validation_happens_before_provider_access():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/tts/generate", json={"text": "   "})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_frontend_has_no_server_secrets():
    """The React/Vite bundle source and its public env files must never reference server secrets."""
    # tests -> orchestrator -> services -> api -> apps
    frontend_dir = __import__("pathlib").Path(__file__).parents[4] / "frontend"
    sources = list((frontend_dir / "src").rglob("*.ts")) + list((frontend_dir / "src").rglob("*.tsx"))
    sources += [path for path in frontend_dir.glob(".env*") if path.is_file()]
    assert sources, "frontend sources were not found"
    for path in sources:
        content = path.read_text(encoding="utf-8")
        for forbidden in (
            "ELEVENLABS_API_KEY",
            "LIVEAVATAR_API_KEY",
            "LIVEKIT_API_SECRET",
            "DATABASE_PASSWORD",
            "POSTGRES_PASSWORD",
        ):
            assert forbidden not in content, f"{path} references {forbidden}"

import httpx
import pytest

from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE


@pytest.mark.asyncio
async def test_liveness_does_not_leak_configuration():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "key" not in response.text.lower()
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
async def test_validation_happens_before_provider_access(api):
    # Generation needs the admin role; without it the answer would be 401 before validation.
    await api.login(ADMIN_PHONE)

    response = await api.client.post("/tts/generate", json={"text": "   "})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert api.tts.calls == []


def test_frontend_has_no_server_secrets():
    """The React/Vite bundle source and its public env files must never reference server secrets.

    The orchestrator image ships only apps/api/services, so the frontend tree is absent there and
    this skips. CI still runs the same check on the full checkout via scripts/check-frontend-secrets
    in the frontend job.
    """
    import pathlib

    # tests -> orchestrator -> services -> api -> apps -> repository root
    frontend_dir = pathlib.Path(__file__).resolve().parents[5] / "apps" / "frontend"
    if not frontend_dir.is_dir():
        pytest.skip("frontend tree is not present in this image; see scripts/check-frontend-secrets")

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

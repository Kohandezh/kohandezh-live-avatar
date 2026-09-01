import asyncio

import httpx

from services.orchestrator.src.errors import ConfigurationError, ProviderError


class LiveAvatarClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float = 30,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._owned_client = http_client is None
        self.http = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if self._owned_client:
            await self.http.aclose()

    def _require_key(self) -> None:
        if not self.api_key:
            raise ConfigurationError("LIVEAVATAR_API_KEY is not configured")

    async def create_token(
        self,
        *,
        avatar_id: str,
        sandbox: bool,
        max_session_duration: int,
        livekit_url: str,
        livekit_agent_token: str,
    ) -> dict:
        self._require_key()
        payload = {
            "mode": "LITE",
            "avatar_id": avatar_id,
            "is_sandbox": sandbox,
            "max_session_duration": max_session_duration,
            "video_settings": {"quality": "high", "encoding": "H264"},
            "livekit_config": {"url": livekit_url, "token": livekit_agent_token},
        }
        response = await self._request(
            "POST",
            "/v1/sessions/token",
            headers={"X-API-KEY": self.api_key},
            json=payload,
        )
        return self._data(response)

    async def start_session(self, session_token: str) -> dict:
        response = await self._request(
            "POST", "/v1/sessions/start", headers={"Authorization": f"Bearer {session_token}"}
        )
        return self._data(response)

    async def stop_session(self, session_token: str) -> None:
        # The current official SDK demo terminates the provider session with this canonical request.
        await self._request("DELETE", "/v1/sessions", headers={"Authorization": f"Bearer {session_token}"})

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        for attempt in range(3):
            try:
                response = await self.http.request(method, f"{self.base_url}{path}", **kwargs)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt == 2:
                    raise ProviderError(
                        "liveavatar_timeout", "LiveAvatar did not respond after 3 bounded attempts", 504, True
                    ) from exc
                await asyncio.sleep(0.25 * (2**attempt))
                continue
            if response.status_code < 400:
                return response
            message = self._provider_message(response)
            if response.status_code in {401, 403}:
                raise ProviderError(
                    "liveavatar_auth", "LiveAvatar rejected the server credentials", 502, False
                )
            if (
                response.status_code in {402, 429}
                or "credit" in message.lower()
                or "quota" in message.lower()
            ):
                raise ProviderError(
                    "liveavatar_quota", "LiveAvatar credits or concurrency are exhausted", 429, False
                )
            if response.status_code >= 500 and attempt < 2:
                await asyncio.sleep(0.25 * (2**attempt))
                continue
            raise ProviderError(
                "liveavatar_error",
                f"LiveAvatar request failed with provider status {response.status_code}: {message[:160]}",
                502,
                response.status_code >= 500,
            )
        raise AssertionError("unreachable")

    @staticmethod
    def _provider_message(response: httpx.Response) -> str:
        try:
            body = response.json()
            return str(body.get("message") or body.get("detail") or "provider error")
        except ValueError:
            return "provider error"

    @staticmethod
    def _data(response: httpx.Response) -> dict:
        body = response.json()
        data = body.get("data")
        if not isinstance(data, dict):
            raise ProviderError(
                "liveavatar_protocol", "LiveAvatar returned an invalid response shape", 502, False
            )
        return data

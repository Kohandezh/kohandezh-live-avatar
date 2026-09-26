from dataclasses import dataclass
from typing import Any


@dataclass
class AppError(Exception):
    code: str
    message: str
    status_code: int = 500
    retryable: bool = False
    details: dict[str, Any] | None = None
    # HTTP headers the error response carries, for example Retry-After.
    headers: dict[str, str] | None = None

    def __str__(self) -> str:
        return self.message


class ConfigurationError(AppError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__("configuration_error", message, 503, False, details)


class ProviderError(AppError):
    pass


class AudioFormatError(AppError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__("audio_format_mismatch", message, 422, False, details)


class NotFoundError(AppError):
    def __init__(self, resource: str):
        super().__init__("not_found", f"{resource} was not found", 404, False)


class ConflictError(AppError):
    def __init__(self, message: str):
        super().__init__("duplicate_generation", message, 409, True)


class ValidationError(AppError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__("validation_error", message, 422, False, details)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "a valid session is required", code: str = "unauthorized"):
        super().__init__(code, message, 401, False)


class ForbiddenError(AppError):
    def __init__(self, message: str, code: str = "forbidden"):
        super().__init__(code, message, 403, False)


class RateLimitedError(AppError):
    """Too many requests. retryAfterSeconds tells the client when to try again.

    `retry_after_header` also sends the wait as the HTTP Retry-After header. Only the routes whose
    contract names the header set it, so the other 429 answers stay as they are.
    """

    def __init__(
        self, code: str, message: str, retry_after_seconds: int, *, retry_after_header: bool = False
    ):
        headers = {"Retry-After": str(retry_after_seconds)} if retry_after_header else None
        super().__init__(code, message, 429, True, {"retryAfterSeconds": retry_after_seconds}, headers)

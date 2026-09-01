from dataclasses import dataclass
from typing import Any


@dataclass
class AppError(Exception):
    code: str
    message: str
    status_code: int = 500
    retryable: bool = False
    details: dict[str, Any] | None = None

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

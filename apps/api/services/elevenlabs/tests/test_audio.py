import struct

import pytest

from services.elevenlabs.audio import REQUIRED_PCM, AudioFormatError, validate_pcm


def test_valid_pcm_duration_is_calculated_from_explicit_contract():
    audio = struct.pack("<h", 10) * REQUIRED_PCM.sample_rate
    assert validate_pcm(audio) == 1000


@pytest.mark.parametrize(
    ("kwargs", "problem"),
    [
        ({"sample_rate": 16000}, "sample_rate"),
        ({"channels": 2}, "channels"),
        ({"sample_width": 1}, "sample_width"),
    ],
)
def test_invalid_contract_is_rejected(kwargs, problem):
    with pytest.raises(AudioFormatError) as error:
        validate_pcm(b"\x00\x00", **kwargs)
    assert problem in str(error.value.details)


def test_unaligned_or_empty_pcm_is_rejected():
    with pytest.raises(AudioFormatError):
        validate_pcm(b"\x00")
    with pytest.raises(AudioFormatError):
        validate_pcm(b"")

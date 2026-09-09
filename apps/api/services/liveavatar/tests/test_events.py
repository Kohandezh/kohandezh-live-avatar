import pytest
from pydantic import ValidationError

from services.liveavatar.events import COMMAND_EVENTS, RESPONSE_EVENTS, IncomingEvent, LiveAvatarEventType


def test_exact_documented_lite_command_events_are_declared():
    assert {event.value for event in COMMAND_EVENTS} == {
        "agent.interrupt",
        "agent.speak",
        "agent.speak_end",
        "agent.start_listening",
        "agent.stop_listening",
        "session.keep_alive",
    }


def test_exact_documented_response_events_are_declared():
    assert {event.value for event in RESPONSE_EVENTS} == {
        "session.state_updated",
        "agent.speak_started",
        "agent.speak_ended",
    }
    parsed = IncomingEvent.model_validate({"type": "agent.speak_ended", "event_id": "one"})
    assert parsed.type is LiveAvatarEventType.AGENT_SPEAK_ENDED


def test_invented_event_is_rejected():
    with pytest.raises(ValidationError):
        IncomingEvent.model_validate({"type": "agent.speak_end_received"})

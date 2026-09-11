from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class LiveAvatarEventType(StrEnum):
    AGENT_INTERRUPT = "agent.interrupt"
    AGENT_SPEAK = "agent.speak"
    AGENT_SPEAK_END = "agent.speak_end"
    AGENT_START_LISTENING = "agent.start_listening"
    AGENT_STOP_LISTENING = "agent.stop_listening"
    SESSION_KEEP_ALIVE = "session.keep_alive"
    SESSION_STATE_UPDATED = "session.state_updated"
    AGENT_SPEAK_STARTED = "agent.speak_started"
    AGENT_SPEAK_ENDED = "agent.speak_ended"
    # Progress events. We parse them so they do not log as unknown, but act on none of them.
    AGENT_AUDIO_BUFFER_APPENDED = "agent.audio_buffer_appended"
    AGENT_AUDIO_BUFFER_COMMITTED = "agent.audio_buffer_committed"
    AGENT_STATE_UPDATED = "agent.state_updated"


COMMAND_EVENTS = {
    LiveAvatarEventType.AGENT_INTERRUPT,
    LiveAvatarEventType.AGENT_SPEAK,
    LiveAvatarEventType.AGENT_SPEAK_END,
    LiveAvatarEventType.AGENT_START_LISTENING,
    LiveAvatarEventType.AGENT_STOP_LISTENING,
    LiveAvatarEventType.SESSION_KEEP_ALIVE,
}

RESPONSE_EVENTS = {
    LiveAvatarEventType.SESSION_STATE_UPDATED,
    LiveAvatarEventType.AGENT_SPEAK_STARTED,
    LiveAvatarEventType.AGENT_SPEAK_ENDED,
}


class IncomingEvent(BaseModel):
    type: LiveAvatarEventType
    state: str | None = None
    # LiveAvatar stamps every event with a fresh event_id of its own. The id WE sent comes back as
    # source_event_id, so that is what correlates a reply to our request.
    event_id: str | None = None
    source_event_id: str | None = None
    task: dict[str, Any] | None = None

    @property
    def correlation_id(self) -> str | None:
        return self.source_event_id or self.event_id


class SpeakEvent(BaseModel):
    type: LiveAvatarEventType = Field(default=LiveAvatarEventType.AGENT_SPEAK)
    event_id: str
    audio: str

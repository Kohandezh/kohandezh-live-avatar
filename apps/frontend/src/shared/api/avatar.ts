import { apiClient } from './client';
import type {
  AvatarCloseResultDto,
  AvatarInterruptResultDto,
  AvatarListeningResultDto,
  AvatarSessionDto,
  AvatarSessionRequestDto,
  AvatarSpeakResultDto,
} from './dto';

// Session lifecycle is entirely server-side: the orchestrator creates the LiveKit room, mints the
// scoped tokens, starts the LiveAvatar LITE session and streams provider audio. The browser only
// receives what it needs to subscribe.
//
// Timeouts are per call because provider work is slow: creating a session waits for
// `session.state_updated`, and speaking waits for `agent.speak_ended`.
export const avatarApi = {
  createSession: (body: AvatarSessionRequestDto = {}) =>
    apiClient
      .post<AvatarSessionDto>('/api/avatar/session', body, { timeout: 60_000 })
      .then((response) => response.data),

  /** Text -> ElevenLabs (server-side, cached) -> LiveAvatar. Waits for `agent.speak_ended`. */
  speak: (sessionId: string, text: string) =>
    apiClient
      .post<AvatarSpeakResultDto>(
        '/api/avatar/speak',
        { session_id: sessionId, text },
        { timeout: 120_000 },
      )
      .then((response) => response.data),

  interrupt: (sessionId: string) =>
    apiClient
      .post<AvatarInterruptResultDto>('/api/avatar/interrupt', {
        session_id: sessionId,
      })
      .then((response) => response.data),

  setListening: (sessionId: string, state: 'start' | 'stop') =>
    apiClient
      .post<AvatarListeningResultDto>(`/api/avatar/listening/${state}`, {
        session_id: sessionId,
      })
      .then((response) => response.data),

  close: (sessionId: string) =>
    apiClient
      .post<AvatarCloseResultDto>(
        '/api/avatar/close',
        { session_id: sessionId },
        { timeout: 30_000 },
      )
      .then((response) => response.data),
};

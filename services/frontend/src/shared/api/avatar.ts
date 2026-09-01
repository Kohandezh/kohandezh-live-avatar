import { api } from './client';
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
export const avatarApi = {
  createSession: (body: AvatarSessionRequestDto = {}) =>
    api.post<AvatarSessionDto>('/avatar/session', body, { timeoutMs: 60_000 }),
  /** Text -> ElevenLabs (server-side, cached) -> LiveAvatar. Waits for `agent.speak_ended`. */
  speak: (sessionId: string, text: string) =>
    api.post<AvatarSpeakResultDto>(
      '/avatar/speak',
      { session_id: sessionId, text },
      { timeoutMs: 120_000 },
    ),
  interrupt: (sessionId: string) =>
    api.post<AvatarInterruptResultDto>('/avatar/interrupt', { session_id: sessionId }),
  setListening: (sessionId: string, state: 'start' | 'stop') =>
    api.post<AvatarListeningResultDto>(`/avatar/listening/${state}`, { session_id: sessionId }),
  close: (sessionId: string) =>
    api.post<AvatarCloseResultDto>(
      '/avatar/close',
      { session_id: sessionId },
      { timeoutMs: 30_000 },
    ),
};

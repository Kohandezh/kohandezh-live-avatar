import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Contract fixtures mirror services/orchestrator/src/schemas.py.
export const fixtures = {
  health: {
    status: 'ok',
    timestamp: '2026-09-01T10:00:00Z',
    dependencies: {
      postgres: { status: 'ok', latency_ms: 1.2 },
      redis: { status: 'ok', latency_ms: 0.4 },
      livekit: { status: 'ok', latency_ms: 3.1 },
      livekit_egress: { status: 'ok', latency_ms: 2.0 },
    },
  },
  audio: {
    id: '11111111-1111-4111-8111-111111111111',
    cache_key: 'a'.repeat(64),
    status: 'AUDIO_GENERATED',
    duration_ms: 1500,
    sample_rate: 24000,
    format: 'pcm_s16le',
    media_url: '/api/assets/audio/11111111-1111-4111-8111-111111111111',
    cache_hit: false,
  },
  session: {
    id: '22222222-2222-4222-8222-222222222222',
    provider_session_id: 'la-session-1',
    room_name: 'avatar-room-1',
    livekit_url: 'wss://live.example.test',
    livekit_client_token: 'eyJhbGciOiJIUzI1NiJ9.eyJyb29tIjoiYXZhdGFyIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
    sandbox: true,
  },
  recording: { id: '33333333-3333-4333-8333-333333333333', egress_id: 'EG_1', status: 'RECORDING' },
  finalize: {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'VIDEO_GENERATED',
    media_url: '/api/assets/video/33333333-3333-4333-8333-333333333333',
    probe: { video_codec: 'h264', audio_codec: 'aac', width: 1280, height: 720, duration_ms: 4200 },
  },
};

export function errorBody(
  code: string,
  message: string,
  retryable = false,
  correlationId = 'corr-1',
) {
  return { error: { code, message, retryable, details: null }, correlation_id: correlationId };
}

export const handlers = [
  http.get('*/api/health', () => HttpResponse.json(fixtures.health)),
  http.post('*/api/tts/generate', () => HttpResponse.json(fixtures.audio)),
  http.get(
    '*/api/assets/audio/:id',
    () => new HttpResponse(new Int16Array(2400).buffer, { status: 200 }),
  ),
  http.post('*/api/avatar/session', () => HttpResponse.json(fixtures.session)),
  http.post('*/api/avatar/speak', () =>
    HttpResponse.json({
      event_id: 'evt-1',
      audio_asset_id: fixtures.audio.id,
      cache_hit: true,
      interrupted: false,
    }),
  ),
  http.post('*/api/avatar/interrupt', () => HttpResponse.json({ status: 'interrupted' })),
  http.post('*/api/avatar/close', () => HttpResponse.json({ status: 'closed' })),
  http.post('*/api/assets/generate-video', () => HttpResponse.json(fixtures.recording)),
  http.post('*/api/assets/video/:id/finalize', () => HttpResponse.json(fixtures.finalize)),
];

export const server = setupServer(...handlers);

import { api, apiUrl } from './client';
import type {
  AudioAssetDto,
  GenerateVideoRequestDto,
  TtsRequestDto,
  VideoFinalizeDto,
  VideoRecordingDto,
} from './dto';

export const assetsApi = {
  /** ElevenLabs synthesis with deterministic server-side cache. May consume provider credits. */
  generateTts: (body: TtsRequestDto) =>
    api.post<AudioAssetDto>('/tts/generate', body, { timeoutMs: 60_000 }),
  /** Raw PCM S16LE 24 kHz mono bytes of a generated audio asset. */
  fetchAudioPcm: (assetId: string) => api.binary(`/assets/audio/${assetId}`, { timeoutMs: 30_000 }),
  audioUrl: (assetId: string) => apiUrl(`/assets/audio/${assetId}`),
  /** Starts a LiveKit room-composite Egress for the active session's room. */
  generateVideo: (body: GenerateVideoRequestDto) =>
    api.post<VideoRecordingDto>('/assets/generate-video', body, { timeoutMs: 30_000 }),
  /** Stops Egress, waits for the MP4, probes it (H.264 + audio required). */
  finalizeVideo: (videoAssetId: string) =>
    api.post<VideoFinalizeDto>(`/assets/video/${videoAssetId}/finalize`, undefined, {
      timeoutMs: 60_000,
    }),
  videoUrl: (videoAssetId: string) => apiUrl(`/assets/video/${videoAssetId}`),
};

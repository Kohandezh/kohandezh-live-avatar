import { apiClient } from './client';
import type {
  AudioAssetDto,
  GenerateVideoRequestDto,
  TtsRequestDto,
  VideoRecordingDto,
} from './dto';
import { apiUrl } from './urls';

export const assetsApi = {
  /** ElevenLabs synthesis with deterministic server-side cache. May consume provider credits. */
  generateTts: (body: TtsRequestDto) =>
    apiClient
      .post<AudioAssetDto>('/api/tts/generate', body, { timeout: 60_000 })
      .then((response) => response.data),

  /** Raw PCM S16LE 24 kHz mono bytes of a generated audio asset. */
  fetchAudioPcm: (assetId: string) =>
    apiClient
      .get<ArrayBuffer>(`/api/assets/audio/${assetId}`, {
        responseType: 'arraybuffer',
        headers: { Accept: '*/*' },
        timeout: 30_000,
      })
      .then((response) => response.data),

  audioUrl: (assetId: string) => apiUrl(`/api/assets/audio/${assetId}`),

  /** Starts a LiveKit room-composite Egress for the active session's room. */
  generateVideo: (body: GenerateVideoRequestDto) =>
    apiClient
      .post<VideoRecordingDto>('/api/assets/generate-video', body, {
        timeout: 30_000,
      })
      .then((response) => response.data),

  /**
   * Stops Egress and answers `202` with a job id at once. A `finalize_video` job then waits for
   * the MP4 and probes it (H.264 + audio required); poll it with `GET /api/jobs/{jobId}`. The
   * body is `unknown` here: the caller parses it with the job entity's schema.
   */
  finalizeVideo: (videoAssetId: string) =>
    apiClient
      .post<unknown>(`/api/assets/video/${videoAssetId}/finalize`, undefined, {
        timeout: 30_000,
      })
      .then((response) => response.data),

  videoUrl: (videoAssetId: string) => apiUrl(`/api/assets/video/${videoAssetId}`),
};

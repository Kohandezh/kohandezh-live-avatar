import { describe, expect, it } from 'vitest';
import { videoAssetFromDto, videoFinalizeSchema } from '@/entities/video-asset';

const result = {
  id: '33333333-3333-4333-8333-333333333333',
  status: 'VIDEO_GENERATED',
  media_url: '/api/assets/video/33333333-3333-4333-8333-333333333333',
  probe: { video_codec: 'h264', audio_codec: 'aac', duration_ms: 4200 },
};

describe('videoFinalizeSchema', () => {
  it('accepts the result of a finalize job and maps it to a video asset', () => {
    const asset = videoAssetFromDto(videoFinalizeSchema.parse(result));

    expect(asset).toMatchObject({
      id: result.id,
      status: 'VIDEO_GENERATED',
      mediaUrl: result.media_url,
      probe: { videoCodec: 'h264', audioCodec: 'aac', durationMs: 4200 },
    });
  });

  it('rejects a result without a media url', () => {
    expect(videoFinalizeSchema.safeParse({ ...result, media_url: undefined }).success).toBe(false);
  });

  it('rejects an unknown asset status', () => {
    expect(videoFinalizeSchema.safeParse({ ...result, status: 'DONE' }).success).toBe(false);
  });

  it('rejects a probe that is not an object', () => {
    expect(videoFinalizeSchema.safeParse({ ...result, probe: 'h264' }).success).toBe(false);
  });
});

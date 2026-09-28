import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installMockApi,
  MOCK_TTS_MS_PER_CHARACTER,
  mockRecordingTriggers,
  mockSession,
  resetMockLibrary,
} from '@/data/mock';
import { jobAcceptedSchema, jobSchema } from '@/entities/job';
import { libraryRecordingPageSchema } from '@/entities/library-entry';
import { videoFinalizeSchema } from '@/entities/video-asset';
import { isApiError } from '@/shared/api';
import { attachErrorInterceptor } from '@/shared/api/interceptors';

/*
 * The mock's recording chain (TTS, avatar session, speak, Egress, finalize and its job), so the
 * Record answer screen can be walked in a browser without the providers. A marker in the text
 * picks a failure: `mockRecordingTriggers`.
 */

function createClient() {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachErrorInterceptor(client);
  installMockApi(client, { delayMs: 0 });
  return client;
}

async function expectError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(isApiError(error) ? error.status : error).toBe(status);
  if (code && isApiError(error)) expect(error.code).toBe(code);
}

async function startRecording(
  client: ReturnType<typeof createClient>,
  text: string,
) {
  const session = await client.post('/api/avatar/session', {
    max_session_duration: 300,
  });
  const recording = await client.post('/api/assets/generate-video', {
    session_id: session.data.id,
    asset_id: 'AVATAR_20260928120000',
    text,
    audio_asset_id: null,
  });
  return {
    sessionId: String(session.data.id),
    videoId: String(recording.data.id),
  };
}

async function finalize(
  client: ReturnType<typeof createClient>,
  videoId: string,
) {
  const response = await client.post(`/api/assets/video/${videoId}/finalize`);
  expect(response.status).toBe(202);
  return jobAcceptedSchema.parse(response.data).jobId;
}

async function poll(client: ReturnType<typeof createClient>, jobId: string) {
  const response = await client.get(`/api/jobs/${jobId}`);
  return jobSchema.parse(response.data);
}

describe('mock recording chain', () => {
  beforeEach(() => {
    resetMockLibrary();
    mockSession.set('u-admin');
  });

  it('is admin only, like the workbench routes', async () => {
    mockSession.clear();
    await expectError(
      createClient().post('/api/tts/generate', { text: 'سلام' }),
      401,
    );

    mockSession.set('u-user');
    await expectError(
      createClient().post('/api/avatar/session', {}),
      403,
      'forbidden',
    );
  });

  it('gives the audio a duration that grows with the text', async () => {
    const response = await createClient().post('/api/tts/generate', {
      text: 'سلام دنیا',
    });

    expect(response.data).toMatchObject({
      status: 'AUDIO_GENERATED',
      duration_ms: 'سلام دنیا'.length * MOCK_TTS_MS_PER_CHARACTER,
      sample_rate: 24000,
    });
  });

  it('refuses a session longer than the request schema allows', async () => {
    await expectError(
      createClient().post('/api/avatar/session', {
        max_session_duration: 3601,
      }),
      422,
      'validation_error',
    );
  });

  it('answers speak with elevenlabs_payment when the text carries the payment marker', async () => {
    const client = createClient();
    const session = await client.post('/api/avatar/session', {});

    await expectError(
      client.post('/api/avatar/speak', {
        session_id: session.data.id,
        text: `سلام ${mockRecordingTriggers.speechPayment}`,
      }),
      502,
      'elevenlabs_payment',
    );
  });

  it('refuses a second recording of the same session with duplicate_generation', async () => {
    const client = createClient();
    const { sessionId } = await startRecording(client, 'سلام');

    await expectError(
      client.post('/api/assets/generate-video', {
        session_id: sessionId,
        asset_id: 'AVATAR_20260928120001',
        text: 'سلام',
      }),
      409,
      'duplicate_generation',
    );
  });

  it('runs a finalize job to done and lists the new video as unsaved', async () => {
    const client = createClient();
    const { videoId } = await startRecording(client, 'متن ضبط تازه');
    const jobId = await finalize(client, videoId);

    expect(await poll(client, jobId)).toEqual({ status: 'queued' });
    expect(await poll(client, jobId)).toEqual({ status: 'running' });
    const done = await poll(client, jobId);
    expect(done.status).toBe('done');
    const video = videoFinalizeSchema.parse(
      done.status === 'done' ? done.result : null,
    );
    expect(video).toMatchObject({ id: videoId, status: 'VIDEO_GENERATED' });

    const unsaved = libraryRecordingPageSchema.parse(
      (await client.get('/api/admin/library/recordings')).data,
    );
    expect(unsaved.items[0]).toMatchObject({
      videoAssetId: videoId,
      answerText: 'متن ضبط تازه',
    });
  });

  it('answers a repeated finalize with the same running job', async () => {
    const client = createClient();
    const { videoId } = await startRecording(client, 'سلام');

    expect(await finalize(client, videoId)).toBe(
      await finalize(client, videoId),
    );
  });

  it('fails the job with egress_failure when the text carries the failure marker', async () => {
    const client = createClient();
    const { videoId } = await startRecording(
      client,
      `سلام ${mockRecordingTriggers.finalizeFails}`,
    );
    const jobId = await finalize(client, videoId);

    await poll(client, jobId);
    await poll(client, jobId);
    expect(await poll(client, jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'egress_failure' },
    });
  });

  it('keeps the job running when the text carries the slow marker', async () => {
    const client = createClient();
    const { videoId } = await startRecording(
      client,
      `سلام ${mockRecordingTriggers.finalizeSlow}`,
    );
    const jobId = await finalize(client, videoId);

    for (let index = 0; index < 5; index += 1) await poll(client, jobId);
    expect(await poll(client, jobId)).toEqual({ status: 'running' });
  });

  it('answers a repeated finalize with the same job while a slow job is still running', async () => {
    const client = createClient();
    const { videoId } = await startRecording(
      client,
      `سلام ${mockRecordingTriggers.finalizeSlow}`,
    );
    const jobId = await finalize(client, videoId);
    for (let index = 0; index < 5; index += 1) await poll(client, jobId);

    expect(await finalize(client, videoId)).toBe(jobId);
  });

  it('starts a new job for a finalize after a failed one', async () => {
    const client = createClient();
    const { videoId } = await startRecording(
      client,
      `سلام ${mockRecordingTriggers.finalizeFails}`,
    );
    const jobId = await finalize(client, videoId);
    for (let index = 0; index < 3; index += 1) await poll(client, jobId);

    expect(await finalize(client, videoId)).not.toBe(jobId);
  });

  it('forgets the recordings and their jobs on reset', async () => {
    const client = createClient();
    const { videoId } = await startRecording(client, 'سلام');
    const jobId = await finalize(client, videoId);

    resetMockLibrary();

    await expectError(client.get(`/api/jobs/${jobId}`), 404, 'not_found');
  });
});

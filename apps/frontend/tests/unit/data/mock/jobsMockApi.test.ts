import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockJobIds, mockSession } from '@/data/mock';
import { jobSchema } from '@/entities/job';
import { videoFinalizeSchema } from '@/entities/video-asset';
import { isApiError } from '@/shared/api';
import { attachErrorInterceptor } from '@/shared/api/interceptors';

function createClient() {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachErrorInterceptor(client);
  installMockApi(client, { delayMs: 0 });
  return client;
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(isApiError(error) ? error.status : error).toBe(status);
}

describe('mock jobs API', () => {
  beforeEach(() => {
    mockSession.clear();
  });

  it('needs a session', async () => {
    await expectStatus(createClient().get(`/api/jobs/${mockJobIds.running}`), 401);
  });

  it('lets the user who started a job read it', async () => {
    mockSession.set('u-user');

    const response = await createClient().get(`/api/jobs/${mockJobIds.running}`);

    expect(jobSchema.parse(response.data)).toEqual({ status: 'running' });
  });

  it('gives an admin the result of a done finalize job', async () => {
    mockSession.set('u-admin');

    const response = await createClient().get(`/api/jobs/${mockJobIds.done}`);
    const job = jobSchema.parse(response.data);

    expect(job.status).toBe('done');
    const result = job.status === 'done' ? videoFinalizeSchema.parse(job.result) : null;
    expect(result?.status).toBe('VIDEO_GENERATED');
  });

  it('gives an admin the error of a failed job and of a system job', async () => {
    mockSession.set('u-admin');
    const client = createClient();

    const failed = jobSchema.parse((await client.get(`/api/jobs/${mockJobIds.failed}`)).data);
    const system = jobSchema.parse((await client.get(`/api/jobs/${mockJobIds.system}`)).data);

    expect(failed).toEqual({
      status: 'failed',
      error: { code: 'egress_failure', message: 'The recording file did not appear in time.' },
    });
    expect(system).toEqual({ status: 'queued' });
  });

  it('answers 404 for another user’s job, a system job and an unknown id alike', async () => {
    mockSession.set('u-user');
    const client = createClient();

    await expectStatus(client.get(`/api/jobs/${mockJobIds.done}`), 404);
    await expectStatus(client.get(`/api/jobs/${mockJobIds.system}`), 404);
    await expectStatus(client.get('/api/jobs/no-such-job'), 404);
  });
});

import { describe, expect, it } from 'vitest';
import { jobAcceptedSchema, jobSchema } from '@/entities/job';

describe('jobSchema', () => {
  it('accepts a queued and a running job with no result', () => {
    expect(jobSchema.parse({ status: 'queued' })).toEqual({ status: 'queued' });
    expect(jobSchema.parse({ status: 'running' })).toEqual({ status: 'running' });
  });

  it('accepts a done job with its result', () => {
    const job = { status: 'done', result: { id: 'v1' } };

    expect(jobSchema.parse(job)).toEqual(job);
  });

  it('accepts a failed job with its error', () => {
    const job = {
      status: 'failed',
      error: { code: 'egress_failure', message: 'The recording file did not appear in time.' },
    };

    expect(jobSchema.parse(job)).toEqual(job);
  });

  it('rejects an unknown status', () => {
    expect(jobSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });

  it('rejects a failed job without an error code', () => {
    expect(jobSchema.safeParse({ status: 'failed' }).success).toBe(false);
    expect(
      jobSchema.safeParse({ status: 'failed', error: { message: 'x' } }).success,
    ).toBe(false);
  });
});

describe('jobAcceptedSchema', () => {
  it('accepts the 202 answer of a long operation', () => {
    expect(jobAcceptedSchema.parse({ jobId: 'j-1' })).toEqual({ jobId: 'j-1' });
  });

  it('rejects an answer without a job id', () => {
    expect(jobAcceptedSchema.safeParse({}).success).toBe(false);
    expect(jobAcceptedSchema.safeParse({ jobId: '' }).success).toBe(false);
  });
});

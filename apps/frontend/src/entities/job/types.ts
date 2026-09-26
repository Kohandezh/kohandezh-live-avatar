import { z } from 'zod';

/**
 * GET /api/jobs/{jobId}: the poll for a long operation (docs/API.md). `result` is the job's
 * output; the operation that started the job owns its shape and parses it. `error.message` is a
 * fixed English text per `code`, never user text.
 */
export const jobSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({ status: z.literal('running') }),
  z.object({ status: z.literal('done'), result: z.unknown() }),
  z.object({
    status: z.literal('failed'),
    error: z.object({ code: z.string().min(1), message: z.string() }),
  }),
]);

export type Job = z.infer<typeof jobSchema>;
export type FinishedJob = Extract<Job, { status: 'done' | 'failed' }>;

/** The `202 Accepted` answer of an operation that runs as a job. */
export const jobAcceptedSchema = z.object({ jobId: z.string().min(1) });

export type JobAccepted = z.infer<typeof jobAcceptedSchema>;

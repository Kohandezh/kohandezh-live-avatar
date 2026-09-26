import { apiClient } from '@/shared/api';
import { jobSchema } from './types';

/** The job's creator or an admin. Anyone else gets 404, like an unknown id. */
export async function getJob(jobId: string) {
  const { data } = await apiClient.get(`/api/jobs/${encodeURIComponent(jobId)}`);
  return jobSchema.parse(data);
}

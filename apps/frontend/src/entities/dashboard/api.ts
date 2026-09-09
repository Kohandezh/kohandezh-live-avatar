import { apiClient } from '@/shared/api';
import { dashboardSummarySchema } from './types';

/** Admin only. The backend must enforce the admin check. */
export async function getDashboardSummary() {
  const { data } = await apiClient.get('/api/admin/dashboard');
  return dashboardSummarySchema.parse(data);
}

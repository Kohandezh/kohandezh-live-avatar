import { z } from 'zod';

/** GET /api/admin/dashboard */
export const dashboardSummarySchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative(),
  disabledUsers: z.number().int().nonnegative(),
  newUsersThisWeek: z.number().int().nonnegative(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

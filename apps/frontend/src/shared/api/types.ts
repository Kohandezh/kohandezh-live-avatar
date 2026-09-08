import { z } from 'zod';

export interface PaginationParams {
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
  /** Free-text search. */
  q?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
}

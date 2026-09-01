// Contract-level shapes shared by all endpoints. See docs/api/openapi.yaml.
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
}

// App-level re-export. The env reader lives in shared/config so lower layers (shared/api) can use it
// without importing from app/ (layer rule).
export { config } from '@shared/config';
export type { AppConfig } from '@shared/config';

export {
  api,
  request,
  requestBinary,
  apiUrl,
  apiWsUrl,
  apiBaseUrl,
  setCredentialsProvider,
  setUnauthorizedHandler,
} from './client';
export { ApiError, codeFromStatus, describeError, isApiError } from './errors';
export type { ApiErrorCode } from './errors';
export { healthApi } from './health';
export { avatarApi } from './avatar';
export { assetsApi } from './assets';
export type * from './dto';

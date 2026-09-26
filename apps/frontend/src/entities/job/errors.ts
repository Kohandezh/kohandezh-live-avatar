/** The job was still queued or running when the caller stopped waiting. */
export class JobTimeoutError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} did not finish in time`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * The job ended `failed`. `code` is the backend's error code; `message` is its fixed English
 * text, for logs and as a fallback when the UI has no translation for `code`.
 */
export class JobFailedError extends Error {
  constructor(
    readonly jobId: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JobFailedError';
  }
}

import { apiClient } from '@/shared/api';
import {
  assistantAnswersReportSchema,
  assistantSessionCloseSchema,
  assistantSessionSchema,
  type AssistantAnswersReport,
  type AssistantSession,
  type AssistantSessionCloseResult,
  type CreateAssistantSessionBody,
  type ReportAssistantAnswersBody,
} from './types';

/**
 * Creating a session calls the provider from the backend (token mint + row insert), so it can
 * take a while on a cold provider. 60 s matches the avatar workbench.
 */
const CREATE_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 30_000;
/** A report is metadata and only writes rows, so it gives up well before the other calls. */
const REPORT_TIMEOUT_MS = 10_000;

export async function createAssistantSession(
  body: CreateAssistantSessionBody = {},
): Promise<AssistantSession> {
  const { data } = await apiClient.post('/api/assistant/session', body, {
    timeout: CREATE_TIMEOUT_MS,
  });
  return assistantSessionSchema.parse(data);
}

/** Idempotent on the backend: closing an already closed session answers 200. */
export async function closeAssistantSession(
  id: string,
): Promise<AssistantSessionCloseResult> {
  const { data } = await apiClient.post(
    `/api/assistant/session/${encodeURIComponent(id)}/close`,
    {},
    { timeout: CLOSE_TIMEOUT_MS },
  );
  return assistantSessionCloseSchema.parse(data);
}

/**
 * Reports measured avatar answers, so the backend writes one usage row per answer. Re-sending the
 * same indexes is safe: the backend counts each index once per session.
 */
export async function reportAssistantAnswers(
  id: string,
  body: ReportAssistantAnswersBody,
): Promise<AssistantAnswersReport> {
  const { data } = await apiClient.post(
    `/api/assistant/session/${encodeURIComponent(id)}/answers`,
    body,
    { timeout: REPORT_TIMEOUT_MS },
  );
  return assistantAnswersReportSchema.parse(data);
}

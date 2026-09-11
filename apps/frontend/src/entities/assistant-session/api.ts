import { apiClient } from '@/shared/api';
import {
  assistantSessionCloseSchema,
  assistantSessionSchema,
  type AssistantSession,
  type AssistantSessionCloseResult,
  type CreateAssistantSessionBody,
} from './types';

/**
 * Creating a session calls the provider from the backend (token mint + row insert), so it can
 * take a while on a cold provider. 60 s matches the avatar workbench.
 */
const CREATE_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 30_000;

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

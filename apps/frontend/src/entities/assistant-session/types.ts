import { z } from 'zod';

export const assistantLanguageSchema = z.enum(['fa', 'en']);
export type AssistantLanguage = z.infer<typeof assistantLanguageSchema>;

/**
 * One LiveAvatar FULL session, minted by our backend (POST /api/assistant/session).
 *
 * `sessionToken` is a provider credential. It is handed to the LiveAvatar SDK once and must
 * never be put into Redux, localStorage, a URL, or a log line. Keep it in a local variable
 * inside the feature hook only.
 */
export const assistantSessionSchema = z.object({
  id: z.string().min(1),
  sessionToken: z.string().min(1),
  providerSessionId: z.string().min(1),
  sandbox: z.boolean(),
  avatarId: z.string().min(1),
  language: assistantLanguageSchema,
  maxSessionDurationSeconds: z.number().int().positive(),
});

export type AssistantSession = z.infer<typeof assistantSessionSchema>;

export const assistantSessionCloseSchema = z.object({
  status: z.literal('closed'),
});

export type AssistantSessionCloseResult = z.infer<
  typeof assistantSessionCloseSchema
>;

/** What the UI keeps about a session. The token is left out on purpose. */
export type AssistantSessionInfo = Omit<AssistantSession, 'sessionToken'>;

export interface CreateAssistantSessionBody {
  language?: AssistantLanguage;
}

/** Drops the provider token so the rest of the app cannot store or log it by accident. */
export function toAssistantSessionInfo(
  session: AssistantSession,
): AssistantSessionInfo {
  return {
    id: session.id,
    providerSessionId: session.providerSessionId,
    sandbox: session.sandbox,
    avatarId: session.avatarId,
    language: session.language,
    maxSessionDurationSeconds: session.maxSessionDurationSeconds,
  };
}

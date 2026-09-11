import { z } from 'zod';

export const assistantLanguageSchema = z.enum(['fa', 'en']);
export type AssistantLanguage = z.infer<typeof assistantLanguageSchema>;

/**
 * Which SDK session class can drive the token the backend minted.
 *
 * `elevenlabs`: a LiveAvatar Voice Agent wrapping the customer's ElevenLabs agent. Needs
 *   `ElevenLabsAgentSession`. This is the only path that speaks Persian today.
 * `full`: LiveAvatar FULL mode with a context persona. Needs `LiveAvatarSession`.
 */
export const assistantAgentTypeSchema = z.enum(['elevenlabs', 'full']);
export type AssistantAgentType = z.infer<typeof assistantAgentTypeSchema>;

/**
 * One assistant session, minted by our backend (POST /api/assistant/session).
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
  // The language the session actually started in. In the `elevenlabs` mode this is always the
  // agent's own language, because LiveAvatar refuses a per-session override for that agent type.
  // In the `full` mode LiveAvatar does not support every language (Persian is not supported).
  language: assistantLanguageSchema,
  // What the caller asked for (or the backend's default, when nothing was asked). In the `full`
  // mode, comparing it to `language` tells whether the backend had to fall back.
  requestedLanguage: assistantLanguageSchema,
  maxSessionDurationSeconds: z.number().int().positive(),
  agentType: assistantAgentTypeSchema,
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
    requestedLanguage: session.requestedLanguage,
    maxSessionDurationSeconds: session.maxSessionDurationSeconds,
    agentType: session.agentType,
  };
}

import { useRef, useSyncExternalStore, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantLanguage } from '@/entities/assistant-session';
import { usePublishConversationLive } from '@/features/navigation';
import {
  useAssistantSession,
  type AssistantController,
} from './useAssistantSession';
import type { AssistantStatus } from './types';

/** The two routes that can hold a live conversation. */
export type ConversationRoute = '/video' | '/audio';

/**
 * A session is "live" from the first backend call until the last one. The navigation
 * guard uses it to ask before leaving, so it must include the states where a provider
 * session exists but no media is flowing yet.
 */
const LIVE_STATUSES: readonly AssistantStatus[] = [
  'requesting',
  'connecting',
  'connected',
  'ending',
];

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * True while the user asked the system for less motion. Read as a store, not as a CSS
 * query, because a media query can hide an animation but cannot stop a `<video>` from
 * playing. The branch has to happen in React.
 *
 * The server snapshot is `false`: no motion preference is known before hydration.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

export interface ConversationScreen {
  /** The one session this screen owns. It closes when the screen unmounts. */
  controller: AssistantController;
  /**
   * The single media element of this screen. `ConversationStage` sets it and attaches
   * the session to it; the audio screen also reads it to measure the avatar's voice.
   */
  stageRef: RefObject<HTMLVideoElement | null>;
}

/**
 * Everything `/video` and `/audio` share.
 *
 * Each screen mounts its own session. Leaving the screen unmounts the page, and
 * `useAssistantSession` closes the provider session and the backend row in its unmount
 * cleanup. That is the whole "switching modes ends the conversation" rule: it needs no
 * extra code, only that the two routes are ordinary siblings.
 *
 * The screen also publishes its live status upwards, because the floating menu and the
 * navigation guard render above the route and cannot reach the controller.
 */
export function useConversationScreen(
  route: ConversationRoute,
): ConversationScreen {
  const { i18n } = useTranslation();
  const language: AssistantLanguage = i18n.language.startsWith('fa')
    ? 'fa'
    : 'en';

  const stageRef = useRef<HTMLVideoElement | null>(null);
  const controller = useAssistantSession({
    language,
    initialMode: route === '/audio' ? 'voice' : 'video',
  });

  const isLive = LIVE_STATUSES.includes(controller.status);

  usePublishConversationLive({
    isLive,
    // Gated on `isLive` on purpose. A speaking flag left over from a session that already
    // ended would block every route change with no way out.
    isAvatarSpeaking: isLive && controller.isAvatarSpeaking,
    liveRoute: isLive ? route : null,
  });

  return { controller, stageRef };
}

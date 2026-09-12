import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/** Which conversation route currently holds the live session, if any. */
export type ConversationLiveRoute = '/video' | '/audio' | null;

export interface ConversationLiveState {
  /** True while a session is requesting, connecting, connected, or ending. */
  isLive: boolean;
  /** True while the avatar is mid-sentence. Drives the navigation block. */
  isAvatarSpeaking: boolean;
  liveRoute: ConversationLiveRoute;
}

const idleState: ConversationLiveState = {
  isLive: false,
  isAvatarSpeaking: false,
  liveRoute: null,
};

type PublishConversationLive = (state: ConversationLiveState) => void;

/**
 * Two contexts, not one object.
 *
 * A single `{ state, publish }` value changes identity on every publish, and a
 * consumer effect that depends on that identity then publishes again, which
 * changes the identity again. That is an infinite loop, and it hangs both
 * conversation screens. Splitting them keeps `publish` referentially stable
 * for the whole life of the provider, so a publishing effect never re-runs
 * just because the state it wrote changed.
 */
const ConversationLiveStateContext =
  createContext<ConversationLiveState>(idleState);

const ConversationLivePublishContext =
  createContext<PublishConversationLive | null>(null);

/**
 * Shares the conversation's live status with code that renders outside the
 * conversation page itself: the floating tab bar (the live dot on `/video`
 * or `/audio`) and the navigation guard (blocking a route change while the
 * avatar is speaking).
 *
 * Plain React context, not Redux: the value tracks `useAssistantSession`,
 * which owns the actual provider session, and that must never be duplicated
 * into global client state (CLAUDE.md: server state does not belong there).
 *
 * Mount this once in the app layout, above both the floating tab bar and the
 * `<Outlet />`. The conversation page publishes into it through
 * `usePublishConversationLive`.
 */
export function ConversationLiveProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<ConversationLiveState>(idleState);

  // Stable for the life of the provider: `setState` is stable and the deps are
  // empty. The functional updater keeps the previous object when nothing
  // actually changed, so a page that republishes an equal snapshot on every
  // render does not re-render every reader of this context.
  const publish = useCallback<PublishConversationLive>((next) => {
    setState((previous) =>
      previous.isLive === next.isLive &&
      previous.isAvatarSpeaking === next.isAvatarSpeaking &&
      previous.liveRoute === next.liveRoute
        ? previous
        : next,
    );
  }, []);

  return (
    <ConversationLivePublishContext.Provider value={publish}>
      <ConversationLiveStateContext.Provider value={state}>
        {children}
      </ConversationLiveStateContext.Provider>
    </ConversationLivePublishContext.Provider>
  );
}

/**
 * Reads the live conversation state. Safe to call anywhere: outside the
 * provider (a screen rendered in isolation, a test) it reads as "nothing is
 * live" instead of throwing.
 */
export function useConversationLive(): ConversationLiveState {
  return useContext(ConversationLiveStateContext);
}

/**
 * Lets the conversation page publish its own live status. Pass the latest
 * snapshot on every render; the shared state resets to idle when the page
 * unmounts, so leaving `/video` or `/audio` clears the live dot and
 * un-blocks navigation on its own.
 */
export function usePublishConversationLive(state: ConversationLiveState): void {
  const publish = useContext(ConversationLivePublishContext);
  const { isLive, isAvatarSpeaking, liveRoute } = state;

  useEffect(() => {
    publish?.({ isLive, isAvatarSpeaking, liveRoute });
  }, [publish, isLive, isAvatarSpeaking, liveRoute]);

  useEffect(() => {
    // Reset only on unmount. Publishing the live snapshot is handled above.
    return () => publish?.(idleState);
  }, [publish]);
}

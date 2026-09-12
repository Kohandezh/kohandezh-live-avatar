import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '@heroui/react';
import { useConversationLive } from './ConversationLiveContext';

export interface NavigationGuard {
  /** The current route, so a caller can mark its own active item by hand. */
  currentPath: string;
  /**
   * Non-null while the confirm-leave dialog should be open, holding the
   * route it would navigate to if the user accepts.
   */
  pendingTarget: string | null;
  /** Call from a menu item's press handler instead of navigating directly. */
  requestNavigate: (target: string) => void;
  /** The user chose to end the conversation and leave. */
  confirmLeave: () => void;
  /** The user chose to stay on the current screen. */
  cancelLeave: () => void;
}

/**
 * Guards every route change made through the floating tab bar.
 *
 * This is the user's decision (see DESIGN_AMENDMENTS.md amendment 1), not the
 * original design:
 *
 * 1. Navigation is blocked outright while the avatar is speaking. A blocked
 *    tap shows a toast instead of silently doing nothing or disabling the
 *    item: the user chose the toast over dimming the menu, so the tap must
 *    stay reachable in order to explain itself.
 * 2. Otherwise, if a conversation is live, ask for confirmation first.
 *    Switching video and audio, or leaving to settings, both end the call.
 *    Accepting the dialog just navigates: `useAssistantSession`'s own
 *    unmount cleanup is what actually closes the session, so no extra code
 *    is needed to end it.
 * 3. Otherwise, navigate right away.
 *
 * Reads `ConversationLiveContext` directly rather than taking it as an
 * argument: the provider is mounted in the app layout above both the tab bar
 * and the `<Outlet />`, so the same rule applies to every menu target,
 * including `/settings`.
 */
export function useNavigationGuard(): NavigationGuard {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isLive, isAvatarSpeaking } = useConversationLive();
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  const requestNavigate = useCallback(
    (target: string) => {
      if (isAvatarSpeaking) {
        toast(t('nav.blocked.speaking'));
        return;
      }
      if (target === location.pathname) return;
      if (isLive) {
        setPendingTarget(target);
        return;
      }
      navigate(target);
    },
    [isAvatarSpeaking, isLive, location.pathname, navigate, t],
  );

  const confirmLeave = useCallback(() => {
    // Read `pendingTarget` from the closure rather than the functional form
    // of `setPendingTarget`: React Strict Mode replays a state updater
    // function to check it is pure, which would call `navigate` twice.
    if (pendingTarget) navigate(pendingTarget);
    setPendingTarget(null);
  }, [navigate, pendingTarget]);

  const cancelLeave = useCallback(() => setPendingTarget(null), []);

  return {
    currentPath: location.pathname,
    pendingTarget,
    requestNavigate,
    confirmLeave,
    cancelLeave,
  };
}

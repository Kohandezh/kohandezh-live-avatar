import { Outlet, useMatch } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import {
  ConversationLiveProvider,
  FloatingTabBar,
  useConversationLive,
} from '@/features/navigation';
import { OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

/**
 * Reads everything the shell needs to decide whether to draw the floating menu, and
 * draws it. Split out from `WebLayout` so it can sit inside `ConversationLiveProvider`
 * and read `useConversationLive()` for the live dot.
 */
function WebShell() {
  const { user, isAuthenticated } = useSession();
  const { liveRoute } = useConversationLive();

  // See MobileLayout for why every `useMatch` runs unconditionally before `showDock`
  // combines them: a `&&` chain that skips a hook call while anonymous changes the
  // hook count the moment the `me` query resolves and crashes React.
  const onboardingMatch = useMatch('/onboarding');
  const videoMatch = useMatch('/video');
  const audioMatch = useMatch('/audio');
  const settingsMatch = useMatch('/settings/*');

  // Named product routes only, so a mistyped URL or `/forbidden` never shows chrome that
  // belongs to a page it isn't. (The Phase 1 workbench left this target: it is Record answer,
  // `/library/record`, on the admin target.)
  const isProductRoute = Boolean(videoMatch || audioMatch || settingsMatch);

  // Same routes as MobileLayout's `isFullBleedRoute`, and the same reason: `/video` and
  // `/audio` already show their own offline message, so the shell banner below would be
  // a duplicate there, and it sits above `<main>` in normal flow, so it pushes the page
  // down the moment the network drops. It also decides `dock-clear` on `<main>` further
  // down: the conversation pages already pay that clearance on their own column, so
  // paying it again here would push anything anchored to the bottom about 84px too high.
  // See MobileLayout for the full reasoning.
  const isFullBleedRoute = Boolean(videoMatch || audioMatch);
  const showDock =
    isAuthenticated &&
    Boolean(user?.firstName.trim()) &&
    !onboardingMatch &&
    isProductRoute;

  return (
    <div className="relative flex h-dvh w-screen flex-col overflow-hidden bg-background">
      {!isFullBleedRoute && (
        <div className="shrink-0">
          <OfflineBanner />
        </div>
      )}

      <main
        className={cn(
          'mx-auto w-full max-w-5xl flex-1 overflow-y-auto overscroll-y-contain px-4',
          !isFullBleedRoute && 'dock-clear',
        )}
      >
        <Outlet />
      </main>

      {showDock ? (
        <FloatingTabBar liveRoute={liveRoute} onVideo={Boolean(videoMatch)} />
      ) : null}

      <PwaUpdatePrompt />
    </div>
  );
}

/**
 * Web shell: the same locked shape as the mobile shell, `h-dvh overflow-hidden` with a
 * scrolling `<main>`, instead of the old `flex min-h-dvh flex-col` document that scrolled
 * as a whole. That old shape is why a floating dock could not work here: an absolutely
 * positioned element anchors to the nearest positioned ancestor, and a document that
 * scrolls takes the dock's `relative` root along with it, so the dock would drift to the
 * bottom of the page instead of staying pinned to the viewport.
 *
 * Requirements 6 and 9 remove the header and the footer entirely. What is left beyond
 * the mobile shell is `PwaUpdatePrompt` and the wider `max-w-5xl` content container.
 *
 * `ConversationLiveProvider` wraps both the menu and the outlet, same as on mobile: see
 * `MobileLayout` for why this is a React context and not Redux.
 */
export function WebLayout() {
  return (
    <ConversationLiveProvider>
      <WebShell />
    </ConversationLiveProvider>
  );
}

import { Outlet, useMatch } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import {
  ConversationLiveProvider,
  FloatingTabBar,
  useConversationLive,
} from '@/features/navigation';
import { OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Reads everything the shell needs to decide whether to draw the floating menu, and
 * draws it. Split out from `MobileLayout` so it can sit inside `ConversationLiveProvider`
 * and read `useConversationLive()` for the live dot.
 */
function MobileShell() {
  const { user, isAuthenticated } = useSession();
  const { liveRoute } = useConversationLive();

  // Every `useMatch` call runs unconditionally, in a fixed order, before any of them
  // is combined into `showDock` below. A `&&` chain that only calls a hook once the
  // user turns out to be authenticated changes the hook count between renders and
  // crashes React ("Rendered more hooks than during the previous render") the moment
  // the `me` query resolves.
  const onboardingMatch = useMatch('/onboarding');
  const videoMatch = useMatch('/video');
  const audioMatch = useMatch('/audio');
  const settingsMatch = useMatch('/settings/*');

  // The floating menu belongs to the product screens only: signed in, named (the
  // server's `firstName`, never a local flag), not on `/onboarding`, and not on
  // `/forbidden` or the `*` not-found catch-all either. Naming the product routes
  // explicitly is what keeps a signed-in user's mistyped URL or a disabled account
  // from showing chrome for a page that has none.
  const isProductRoute = Boolean(videoMatch || audioMatch || settingsMatch);

  // The conversation screens draw their own full-bleed stage, which has to run all the
  // way to the bottom edge so the floating glass menu has the video behind it to blur
  // (that is what `onVideo` / `data-glass="strong"` exist for). Paying `dock-clear` here
  // would stop the stage above the menu and leave a flat band of page background under
  // it. Those screens pay the clearance on their own chrome column instead, so their
  // controls still sit above the menu. Every scrolling screen keeps it here.
  const isFullBleedRoute = Boolean(videoMatch || audioMatch);
  const showDock =
    isAuthenticated &&
    Boolean(user?.firstName.trim()) &&
    !onboardingMatch &&
    isProductRoute;

  return (
    <div className="relative flex h-dvh w-screen flex-col overflow-hidden bg-background">
      <div className="shrink-0">
        <OfflineBanner />
      </div>

      <main
        className={cn(
          'flex-1 overflow-y-auto overscroll-y-contain',
          !isFullBleedRoute && 'dock-clear',
        )}
      >
        <Outlet />
      </main>

      {showDock ? (
        <FloatingTabBar liveRoute={liveRoute} onVideo={Boolean(videoMatch)} />
      ) : null}
    </div>
  );
}

/**
 * Mobile shell: a locked viewport (`h-dvh overflow-hidden`) with a scrolling `<main>`
 * and the floating glass menu, instead of the old fixed header and docked tab bar
 * (requirements 2, 3, 4, 6 remove the header entirely; requirement 14 is the menu).
 *
 * `ConversationLiveProvider` wraps both the menu and the outlet: `/video` and `/audio`
 * publish their live status into it from below (through `useConversationScreen`), and
 * `FloatingTabBar`'s live dot plus the navigation guard both read it from here. Plain
 * React context, not Redux — the value tracks a live session, which is server state and
 * must not be duplicated into client-owned global state.
 */
export function MobileLayout() {
  return (
    <ConversationLiveProvider>
      <MobileShell />
    </ConversationLiveProvider>
  );
}

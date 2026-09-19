import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog } from '@heroui/react';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { ConversationLiveRoute } from './ConversationLiveContext';
import { useNavigationGuard } from './useNavigationGuard';

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M21.5 8.2 16.5 12l5 3.8V8.2Z" />
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v1.5M8 9v7M12 5v15M16 9v7M20 12v1.5" />
    </svg>
  );
}

interface TabItem {
  to: '/settings' | '/video' | '/audio';
  label: string;
  icon: ReactNode;
}

export interface FloatingTabBarProps {
  /**
   * Which conversation route currently holds the live session, if any. Kept
   * a prop rather than read from context here: `ConversationLiveContext`
   * does not exist on `/settings`, and passing it down from the layout
   * (which does sit inside the provider) keeps this component simple to
   * render anywhere.
   */
  liveRoute: ConversationLiveRoute;
  /** Raises the tint so the icons stay readable over a live video. */
  onVideo?: boolean;
  className?: string;
}

/**
 * The floating liquid-glass pill: settings, video, audio. Requirement 14.
 *
 * Icon-only. Each item keeps its word as `sr-only` text, so the accessible name, voice
 * control and the search for "Settings" are all unchanged; only the pixels are gone.
 *
 * Items are plain buttons, not `NavLink`s: a press first runs the navigation
 * guard (blocked while the avatar is speaking, confirmed when a conversation
 * is live), and only a guard-approved press calls `navigate`. Because of
 * that, `aria-current` is set by hand instead of relying on `NavLink`.
 */
export function FloatingTabBar({
  liveRoute,
  onVideo,
  className,
}: FloatingTabBarProps) {
  const { t } = useTranslation();
  const guard = useNavigationGuard();

  const items: TabItem[] = [
    { to: '/settings', label: t('nav.settings'), icon: <SettingsIcon /> },
    { to: '/video', label: t('nav.video'), icon: <VideoIcon /> },
    { to: '/audio', label: t('nav.audio'), icon: <AudioIcon /> },
  ];

  return (
    <>
      <div className={cn('dock-safe z-30', className)}>
        <nav
          aria-label={t('nav.menu')}
          data-glass={onVideo ? 'strong' : undefined}
          className="glass glass-fringe pointer-events-auto mx-auto flex w-fit items-center gap-1 rounded-full p-1.5"
        >
          <ul className="flex items-center gap-1">
            {items.map((item) => {
              // A nested route still belongs to its tab: on
              // `/settings/appearance` the Settings item stays the current
              // one. This is `NavLink`'s own default behaviour, which the
              // bar lost when it swapped `NavLink` for guarded buttons, so
              // it has to be reproduced by hand. The trailing slash keeps a
              // sibling like `/settings-export` from matching.
              const isActive =
                guard.currentPath === item.to ||
                guard.currentPath.startsWith(`${item.to}/`);
              const isItemLive = liveRoute === item.to;

              return (
                <li key={item.to}>
                  <button
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => guard.requestNavigate(item.to)}
                    className={cn(
                      // A 44 px square, which is the minimum touch target and, once the words
                      // are gone, also the whole control. The active pill becomes a circle.
                      'flex size-11 items-center justify-center rounded-full transition-colors focus-visible:focus-ring motion-reduce:transition-none',
                      isActive
                        ? 'bg-accent-soft text-accent-soft-foreground'
                        : 'text-muted hover:text-foreground',
                    )}
                  >
                    <span className="relative flex shrink-0 items-center justify-center">
                      {item.icon}
                      {isItemLive ? (
                        <span
                          aria-hidden="true"
                          className="absolute end-0 top-0 size-1.5 rounded-full bg-success"
                        />
                      ) : null}
                    </span>
                    {/* The name, heard and not seen. The words made the pill wide enough to
                        crowd the corner controls above it on a phone. A screen reader and
                        voice control still get the word from here. */}
                    <span className="sr-only">{item.label}</span>
                    {isItemLive ? (
                      <span className="sr-only">{t('nav.live')}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/*
        The confirm-leave dialog. isDismissable and keyboard-dismiss stay at
        their AlertDialog defaults (no backdrop click, no Escape): the user
        must pick "Stay here" or "End and continue" explicitly, matching the
        product decision that switching screens during a live conversation
        needs to ask first.
      */}
      <AlertDialog.Backdrop
        isOpen={guard.pendingTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) guard.cancelLeave();
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>
                {t('conversation.leave.title')}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t('conversation.leave.body')}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={guard.cancelLeave}>
                {t('conversation.leave.cancel')}
              </Button>
              <Button variant="danger" onPress={guard.confirmLeave}>
                {t('conversation.leave.confirm')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

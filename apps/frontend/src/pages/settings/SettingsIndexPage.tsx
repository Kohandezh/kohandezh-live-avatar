import { Card } from '@heroui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '@/features/settings';
import { ScreenHeader } from '@/shared/ui';

/** Points to the next row. Mirrored in RTL so it keeps pointing "forward". */
function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-muted rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** One navigable row: a real `<Link>`, not a clickable `<div>`. */
function SettingsNavRow({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description?: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 items-center justify-between gap-3 rounded-lg py-3 text-start hover:bg-surface-secondary"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {description ? (
            <span className="block truncate text-xs text-muted">
              {description}
            </span>
          ) : null}
        </span>
        <ChevronIcon />
      </Link>
    </li>
  );
}

/** One non-navigating row: same rhythm as a nav row, but its own content. */
function SettingsControlRow({ children }: { children: ReactNode }) {
  return <li className="flex min-h-11 flex-col gap-2 py-3">{children}</li>;
}

/**
 * Entry point for `/settings` (requirements 5, 15). The floating tab bar is
 * the way in and out, so this screen has no back button.
 *
 * Log out is not a row here: requirement 6 removed the header, which held
 * the only log-out control on web, but the user placed the replacement on
 * `/settings/personal` instead, at the bottom, separated from everything
 * else. See `PersonalInfoPage`.
 */
export function SettingsIndexPage() {
  const { t } = useTranslation();

  return (
    <>
      <ScreenHeader title={t('settings.title')} />

      <div className="flex w-full flex-col gap-6 px-4 pb-8">
        <Card>
          <Card.Content>
            <ul className="flex flex-col divide-y divide-separator">
              <SettingsNavRow
                to="/settings/personal"
                title={t('settings.personal.title')}
                description={t('settings.personal.description')}
              />
              <SettingsNavRow
                to="/settings/appearance"
                title={t('settings.appearance.title')}
                description={t('settings.appearance.description')}
              />
              <SettingsControlRow>
                {/* `w-full` here, not in the component: the switcher also sits
                    on the login screen, where a narrow, centred control is
                    right. On a settings row it is one of the screen's action
                    controls and matches the full-width buttons. */}
                <LanguageSwitcher showLabel className="w-full" />
                <p className="text-xs text-muted">
                  {t('settings.language.description')}
                </p>
              </SettingsControlRow>
            </ul>
          </Card.Content>
        </Card>
      </div>
    </>
  );
}

import { Avatar, Card, Chip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getFullName, type User } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { Button, KeyValue, LoadingState } from '@/shared/ui';
import { formatDate } from '@/shared/utils';

/** First letters of the name. Empty when the account has no name yet. */
function getInitials(user: Pick<User, 'firstName' | 'lastName'>): string {
  return [user.firstName, user.lastName]
    .map((part) => part.trim().charAt(0))
    .filter((letter) => letter !== '')
    .join('')
    .toUpperCase();
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  );
}

/** Protected by RequireAuth in the router, so `user` is normally present. */
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading } = useSession();
  const logout = useLogout();

  if (isLoading || !user) {
    return <LoadingState />;
  }

  const initials = getInitials(user);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t('profile.title')}
      </h1>

      <Card>
        <Card.Header className="flex-row items-center gap-3">
          <Avatar>
            <Avatar.Fallback>
              {initials === '' ? <PersonIcon /> : initials}
            </Avatar.Fallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">
              {getFullName(user)}
            </p>
            <p className="truncate text-sm text-muted" dir="ltr">
              {user.phone}
            </p>
          </div>
        </Card.Header>

        <Card.Content>
          <KeyValue
            items={[
              {
                label: t('profile.email'),
                value: user.email ?? t('profile.noEmail'),
              },
              {
                label: t('profile.role'),
                value: (
                  <Chip
                    className="font-sans"
                    color={user.role === 'admin' ? 'accent' : 'default'}
                    variant="soft"
                    size="sm"
                  >
                    {t(`roles.${user.role}`)}
                  </Chip>
                ),
                ltr: false,
              },
              {
                label: t('profile.memberSince'),
                value: (
                  <span className="font-sans">
                    {formatDate(user.createdAt, i18n.language)}
                  </span>
                ),
                ltr: false,
              },
            ]}
          />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t('profile.settings')}</Card.Title>
        </Card.Header>
        <Card.Content>
          <LanguageSwitcher showLabel />
        </Card.Content>
      </Card>

      <Button
        variant="secondary"
        className="self-start"
        isPending={logout.isPending}
        onPress={() =>
          logout.mutate(undefined, {
            onSettled: () => navigate('/', { replace: true }),
          })
        }
      >
        {t('nav.logout')}
      </Button>
    </section>
  );
}

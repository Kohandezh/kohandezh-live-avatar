import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getFullName } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import { Card, Chip } from '@heroui/react';
import { Button, LoadingState } from '@/shared/ui';
import { formatDate } from '@/shared/utils';

/** Protected by RequireAuth in the router, so `user` is normally present. */
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading } = useSession();
  const logout = useLogout();

  if (isLoading || !user) {
    return <LoadingState />;
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('profile.title')}
      </h1>

      <Card className="flex flex-col gap-4">
        <div>
          <p className="text-lg font-medium">{getFullName(user)}</p>
          <p className="text-sm text-slate-600" dir="ltr">
            {user.phone}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('profile.email')}</dt>
            <dd className="mt-1" dir="ltr">
              {user.email ?? t('profile.noEmail')}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('profile.role')}</dt>
            <dd className="mt-1">
              <Chip color={user.role === 'admin' ? 'accent' : 'default'} variant="soft" size="sm">
                {t(`roles.${user.role}`)}
              </Chip>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('profile.memberSince')}</dt>
            <dd className="mt-1">
              {formatDate(user.createdAt, i18n.language)}
            </dd>
          </div>
        </dl>

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
      </Card>
    </section>
  );
}

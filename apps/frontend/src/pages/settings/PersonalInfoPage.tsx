import { zodResolver } from '@hookform/resolvers/zod';
import { Card, Chip, Separator } from '@heroui/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useUpdateProfile } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import {
  ProfileNameFields,
  profileNameSchema,
  type ProfileNameValues,
} from '@/features/profile';
import { isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { Button, InlineAlert, KeyValue, LoadingState, ScreenHeader } from '@/shared/ui';
import { formatDate } from '@/shared/utils';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Maps a failed profile save to a user-facing, translated message. */
function describeSaveError(t: Translate, error: unknown): string {
  if (isApiError(error) && error.isNetworkError) {
    return t('settings.personal.errors.offline');
  }
  return t('settings.personal.errors.failed');
}

/**
 * `/settings/personal` (requirement 15): the editable name plus the
 * read-only account facts, and log out.
 *
 * Log out lives here, not on the settings index. Requirement 6 removed the
 * header, which held the only log-out control on web, and requirement 15
 * never named a home for it. It sits at the bottom, separated by a
 * `Separator`, in the `danger` variant, so it reads as distinct from the
 * rest of the page rather than as another setting.
 */
export function PersonalInfoPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isOnline = useOnline();
  const { user, isLoading } = useSession();
  const updateProfile = useUpdateProfile();
  const logout = useLogout();

  // Cleared on the next edit: the form's own dirty state, not a timer, drives
  // that. See `showSuccess` below.
  const [justSaved, setJustSaved] = useState(false);

  const form = useForm<ProfileNameValues>({
    resolver: zodResolver(profileNameSchema),
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    },
  });

  const submit = form.handleSubmit((values) => {
    setJustSaved(false);
    updateProfile.mutate(values, {
      onSuccess: (freshUser) => {
        // Resets to the server's own values and clears `isDirty`, so the
        // success message below can key off "saved and untouched since".
        form.reset({
          firstName: freshUser.firstName,
          lastName: freshUser.lastName,
        });
        setJustSaved(true);
      },
    });
  });

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => navigate('/', { replace: true }),
    });
  };

  if (isLoading || !user) {
    return (
      <>
        <ScreenHeader
          title={t('settings.personal.title')}
          onBack={() => navigate('/settings')}
        />
        <LoadingState />
      </>
    );
  }

  // Typing after a save marks the form dirty again, which hides this on its
  // own: no separate timer or "next edit" flag needed.
  const showSuccess = justSaved && !form.formState.isDirty;

  return (
    <>
      <ScreenHeader
        title={t('settings.personal.title')}
        onBack={() => navigate('/settings')}
      />

      <div className="flex w-full flex-col gap-6 px-4 pb-8">
        <Card>
          <Card.Header>
            <Card.Description>
              {t('settings.personal.description')}
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <ProfileNameFields
                control={form.control}
                isDisabled={updateProfile.isPending}
              />

              {!isOnline ? (
                <InlineAlert status="warning">
                  {t('settings.personal.errors.offline')}
                </InlineAlert>
              ) : updateProfile.isError ? (
                <InlineAlert status="danger">
                  {describeSaveError(t, updateProfile.error)}
                </InlineAlert>
              ) : showSuccess ? (
                <InlineAlert status="success">
                  {t('settings.personal.saved')}
                </InlineAlert>
              ) : null}

              <Button
                type="submit"
                isPending={updateProfile.isPending}
                isDisabled={!isOnline || !form.formState.isDirty}
                className="min-h-11 self-start"
              >
                {t('settings.personal.save')}
              </Button>
            </form>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>{t('settings.account.title')}</Card.Title>
          </Card.Header>
          <Card.Content>
            <KeyValue
              items={[
                { label: t('settings.personal.phone'), value: user.phone },
                {
                  label: t('settings.personal.email'),
                  value: user.email ?? t('settings.personal.noEmail'),
                },
                {
                  label: t('settings.personal.role'),
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
                  label: t('settings.personal.memberSince'),
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

        <Separator />

        <Button
          variant="danger"
          isPending={logout.isPending}
          onPress={handleLogout}
          className="min-h-11 self-start"
        >
          {t('nav.logout')}
        </Button>
      </div>
    </>
  );
}

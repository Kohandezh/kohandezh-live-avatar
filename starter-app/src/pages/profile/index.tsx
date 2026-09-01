import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@features/authentication';
import { useUpdateMe } from '@entities/user';
import { AsyncState, Button, TextField } from '@shared/ui';
import { takePhoto } from '@shared/platform';

export function ProfilePage() {
  const { t } = useTranslation();
  const session = useSession();
  const update = useUpdateMe();
  const [name, setName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  return (
    <>
      <h1>{t('profile.title')}</h1>
      <AsyncState {...session} data={session.data ?? undefined} refetch={() => void session.refetch()}>
        {(user) => (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ displayName: name ?? user.displayName });
            }}
          >
            <p dir="ltr">{user.email}</p>
            <TextField
              label={t('profile.displayName')}
              value={name ?? user.displayName}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <Button type="submit" variant="primary" loading={update.isPending}>
                {t('profile.save')}
              </Button>
              <Button
                type="button"
                onClick={async () => {
                  const p = await takePhoto();
                  if (p) setPhoto(p.uri);
                }}
              >
                {t('profile.photo')}
              </Button>
              {update.isSuccess && <span role="status">{t('profile.saved')}</span>}
            </div>
            {photo && <img src={photo} alt="" style={{ marginTop: 'var(--space-3)', maxWidth: 200, borderRadius: 'var(--radius)' }} />}
          </form>
        )}
      </AsyncState>
    </>
  );
}

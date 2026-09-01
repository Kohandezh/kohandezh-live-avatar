import { useTranslation } from 'react-i18next';
import { usePublicUsers } from '@entities/user';
import { AsyncState } from '@shared/ui';
import categories from '@data/categories.json';

// Pages compose entities + features + shared UI. No business logic here.
export function HomePage() {
  const { t, i18n } = useTranslation();
  const users = usePublicUsers({ page: 1, pageSize: 10 });

  return (
    <>
      <h1>{t('home.title')}</h1>

      <h2>{t('home.category')}</h2>
      <div className="chips">
        {categories.map((c) => (
          <span key={c.id} className="chip">
            {i18n.language === 'fa' ? c.label_fa : c.label_en}
          </span>
        ))}
      </div>

      <h2>{t('home.publicUsers')}</h2>
      <AsyncState {...users} isEmpty={(d) => d.items.length === 0} refetch={() => void users.refetch()}>
        {(page) => (
          <ul className="list">
            {page.items.map((u) => (
              <li key={u.id} className="card">
                {u.displayName}
              </li>
            ))}
          </ul>
        )}
      </AsyncState>
    </>
  );
}

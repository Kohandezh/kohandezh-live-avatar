import { useTranslation } from 'react-i18next';
import { AssistantPanel } from '@/features/assistant';

/** Shared by the mobile app and the web PWA. Both routers put it behind RequireAuth. */
export function AssistantPage() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('assistant.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('assistant.subtitle')}</p>
      </div>

      <AssistantPanel />
    </section>
  );
}

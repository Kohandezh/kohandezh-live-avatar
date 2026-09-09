import { useTranslation } from 'react-i18next';
import { isSupportedLanguage, supportedLanguages } from '@/i18n';
import { cn } from '@/shared/utils';
import { useLanguage } from './hooks';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-sm text-slate-600',
        className,
      )}
    >
      <span className="sr-only">{t('language.label')}</span>
      <select
        aria-label={t('language.label')}
        value={language}
        onChange={(event) => {
          const next = event.target.value;
          if (isSupportedLanguage(next)) setLanguage(next);
        }}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
      >
        {supportedLanguages.map((code) => (
          <option key={code} value={code}>
            {t(`language.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

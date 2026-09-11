import { Label, ListBox, Select } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { isSupportedLanguage, supportedLanguages } from '@/i18n';
import { cn } from '@/shared/utils';
import { useLanguage } from './hooks';

/**
 * Language picker. The label is always attached to the control so screen
 * readers announce it; `showLabel` only decides whether it is painted.
 */
export function LanguageSwitcher({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();

  return (
    <Select
      className={cn('w-32', className)}
      value={language}
      onChange={(value) => {
        if (isSupportedLanguage(value)) setLanguage(value);
      }}
    >
      <Label className={showLabel ? undefined : 'sr-only'}>
        {t('language.label')}
      </Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {supportedLanguages.map((code) => (
            <ListBox.Item key={code} id={code} textValue={t(`language.${code}`)}>
              {t(`language.${code}`)}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

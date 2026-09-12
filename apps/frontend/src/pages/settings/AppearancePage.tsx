import { Card, Description, Label, Radio, RadioGroup, Switch } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useReduceTransparency, useTheme, type ThemeMode } from '@/features/settings';
import { ScreenHeader } from '@/shared/ui';

const THEME_OPTIONS: readonly { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'settings.appearance.light' },
  { value: 'dark', labelKey: 'settings.appearance.dark' },
  { value: 'system', labelKey: 'settings.appearance.system' },
];

/**
 * `/settings/appearance` (requirement 13's appearance UI, requirement 15's
 * route for it).
 *
 * Both controls apply the moment they are picked. `setTheme` is read by
 * `ThemeSync` in a layout effect, so the choice is its own preview; there is
 * no separate save step.
 */
export function AppearancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const [reduceTransparency, setReduceTransparency] = useReduceTransparency();

  return (
    <>
      <ScreenHeader
        title={t('settings.appearance.title')}
        onBack={() => navigate('/settings')}
      />

      <div className="flex w-full flex-col gap-6 px-4 pb-8">
        <Card>
          <Card.Content>
            <RadioGroup
              value={theme}
              onChange={(value) => {
                const option = THEME_OPTIONS.find(
                  (item) => item.value === value,
                );
                if (option) setTheme(option.value);
              }}
            >
              <Label>{t('settings.appearance.label')}</Label>
              <Description>{t('settings.appearance.description')}</Description>
              {THEME_OPTIONS.map((option) => (
                <Radio key={option.value} value={option.value}>
                  <Radio.Content className="min-h-11">
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    <Label>{t(option.labelKey)}</Label>
                  </Radio.Content>
                  {option.value === 'system' ? (
                    <Description>
                      {t('settings.appearance.systemHint')}
                    </Description>
                  ) : null}
                </Radio>
              ))}
            </RadioGroup>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content>
            {/*
             * Not polish: Safari and iOS never fire prefers-reduced-transparency
             * in any version, so on the platform whose look is being copied
             * there is no other way to turn off the glass. The `glass`
             * utility honours both the media query and this attribute.
             */}
            <Switch
              className="min-h-11"
              isSelected={reduceTransparency}
              onChange={setReduceTransparency}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label>{t('settings.appearance.reduceTransparency')}</Label>
                <Description>
                  {t('settings.appearance.reduceTransparencyHint')}
                </Description>
              </Switch.Content>
            </Switch>
          </Card.Content>
        </Card>
      </div>
    </>
  );
}

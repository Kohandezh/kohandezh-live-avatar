import {
  Card,
  Description,
  Label,
  Radio,
  RadioGroup,
  Switch,
} from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  useReduceTransparency,
  useTheme,
  type ThemeMode,
} from '@/features/settings';
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
                    {/*
                     * No border class here on purpose. This used to carry
                     * `border border-border`, because HeroUI ships fields
                     * with `--field-border-width: 0px` and `--field-border:
                     * transparent`, which left an unselected radio invisible
                     * against the card. globals.css now gives every field a
                     * real `--surface-edge` border in both themes, so the
                     * radio gets the same 3:1 boundary as every input and a
                     * local override would only fight it.
                     */}
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
            {/*
             * `Switch.Content` is the clickable element (a `<label>` around
             * the hidden input), so everything that should be part of the
             * 44px touch target and the accessible name goes inside it, not
             * as a sibling. HeroUI's own default composition puts the
             * control first and stacks the description below at a fixed
             * indent, which assumes a leading control; a settings row wants
             * the opposite reading order (text on the start side, control at
             * the end), so that default indent is not used here. A flex row's
             * main axis already follows the page's writing direction, so
             * `justify-between` alone puts the text block on the start side
             * and the control on the end side in both LTR and RTL. No
             * `ms-*`/`me-*` class is needed.
             */}
            <Switch
              isSelected={reduceTransparency}
              onChange={setReduceTransparency}
            >
              <Switch.Content className="min-h-11 w-full justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <Label>{t('settings.appearance.reduceTransparency')}</Label>
                  <Description>
                    {t('settings.appearance.reduceTransparencyHint')}
                  </Description>
                </span>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </Card.Content>
        </Card>
      </div>
    </>
  );
}

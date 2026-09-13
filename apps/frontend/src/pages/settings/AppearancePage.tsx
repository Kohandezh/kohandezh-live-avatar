import { Card, Description, Label, ListBox, Slider } from '@heroui/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  REDUCE_TRANSPARENCY_MAX,
  REDUCE_TRANSPARENCY_MIN,
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
 * The slider moves in steps of 5, not 1. A single percent of glass is not a difference anyone
 * can see, and a coarse step is far easier to hit with a thumb on a phone.
 */
const TRANSPARENCY_STEP = 5;

/**
 * `/settings/appearance` (requirement 13's appearance UI, requirement 15's
 * route for it).
 *
 * Both controls apply the moment they are changed. `ThemeSync` reads them in a layout effect, so
 * the choice is its own preview; there is no separate save step.
 */
export function AppearancePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const [reduceTransparency, setReduceTransparency] = useReduceTransparency();

  // A ListBox has no built-in Label slot the way RadioGroup does, so the heading and the hint
  // are plain elements wired up by id. Both are named: the hint goes in `aria-describedby`, not
  // into the label, so a screen reader announces the list once and the explanation after it.
  const themeLabelId = useId();
  const themeHintId = useId();
  const transparencyHintId = useId();

  return (
    <>
      <ScreenHeader
        title={t('settings.appearance.title')}
        onBack={() => navigate('/settings')}
      />

      <div className="flex w-full flex-col gap-6 px-4 pb-8">
        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Label id={themeLabelId} elementType="span">
              {t('settings.appearance.label')}
            </Label>
            <Description id={themeHintId}>
              {t('settings.appearance.description')}
            </Description>

            {/*
             * A ListBox rather than a radio group: the three themes are one short, mutually
             * exclusive list, which is what a listbox is for, and its rows are full-width press
             * targets instead of a small circle plus a label.
             *
             * `disallowEmptySelection` matters here. A single-select listbox otherwise lets the
             * user clear the selection, and there is no such thing as "no theme" — the app would
             * keep rendering the old one with nothing highlighted. The handler guards the same
             * case again, because an empty `Selection` is still representable in the type.
             */}
            <ListBox
              aria-labelledby={themeLabelId}
              aria-describedby={themeHintId}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([theme])}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const [selected] = keys;
                const option = THEME_OPTIONS.find(
                  (item) => item.value === selected,
                );
                if (option) setTheme(option.value);
              }}
            >
              {THEME_OPTIONS.map((option) => (
                <ListBox.Item
                  key={option.value}
                  id={option.value}
                  textValue={t(option.labelKey)}
                  className="min-h-11"
                >
                  <div className="flex flex-col">
                    <Label>{t(option.labelKey)}</Label>
                    {option.value === 'system' ? (
                      <Description>
                        {t('settings.appearance.systemHint')}
                      </Description>
                    ) : null}
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content>
            {/*
             * Not polish: Safari and iOS never fire prefers-reduced-transparency in any version,
             * so on the platform whose look is being copied this is the only way to turn the
             * glass down. The `glass` utility interpolates every one of its values with the
             * level, so the middle of the slider is a real middle, not an on/off switch with
             * extra travel.
             *
             * `formatOptions` with `unit: 'percent'` rather than a hand-built string: it gives
             * Persian digits and the Persian percent sign in fa, and "60%" in en, from the
             * locale React Aria already has.
             */}
            <div className="flex flex-col gap-2">
              {/*
               * Label, Output and Track are the whole anatomy, and nothing else goes inside
               * `Slider`. Its root is a CSS grid with the areas `"label output" / "track
               * track"`, so any extra child is auto-placed into the label or output cell and
               * squeezes the real label into a narrow column. The hint therefore sits outside
               * the slider and is attached with `aria-describedby`, which is also what a
               * screen reader needs: the thumb announces the description, not a stray span.
               */}
              <Slider
                aria-describedby={transparencyHintId}
                value={reduceTransparency}
                onChange={(value) => {
                  if (typeof value === 'number') setReduceTransparency(value);
                }}
                minValue={REDUCE_TRANSPARENCY_MIN}
                maxValue={REDUCE_TRANSPARENCY_MAX}
                step={TRANSPARENCY_STEP}
                formatOptions={{ style: 'unit', unit: 'percent' }}
                className="w-full"
              >
                <Label>{t('settings.appearance.reduceTransparency')}</Label>
                <Slider.Output className="tabular-nums" />
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>

              <Description id={transparencyHintId}>
                {t('settings.appearance.reduceTransparencyHint')}
              </Description>
            </div>
          </Card.Content>
        </Card>
      </div>
    </>
  );
}

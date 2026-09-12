import { zodResolver } from '@hookform/resolvers/zod';
import {
  Card,
  Description,
  Label,
  ProgressBar,
  Radio,
  RadioGroup,
} from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useUpdateProfile } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import {
  ProfileNameFields,
  profileNameSchema,
  type ProfileNameValues,
} from '@/features/profile';
import {
  setMicPermissionAsked,
  useTheme,
  type ThemeMode,
} from '@/features/settings';
import { isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import {
  requestMicrophonePermission,
  type MicPermissionState,
} from '@/shared/platform';
import { Button, InlineAlert } from '@/shared/ui';

const TOTAL_STEPS = 3;

type Step = 1 | 2 | 3;

/**
 * Step 3 asks the OS for the microphone. `idle` is before the ask,
 * `prompting` is while the OS dialog is open, and the rest are terminal:
 * every one of them lets the user move on to the conversation.
 */
type MicOutcome =
  'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable' | 'dismissed';

const THEME_OPTIONS: readonly { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'settings.appearance.light' },
  { value: 'dark', labelKey: 'settings.appearance.dark' },
  { value: 'system', labelKey: 'settings.appearance.system' },
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Maps a failed profile save to a user-facing, translated message. */
function describeSaveError(t: Translate, error: unknown): string {
  if (isApiError(error) && error.isNetworkError) {
    return t('settings.personal.errors.offline');
  }
  return t('settings.personal.errors.failed');
}

/**
 * `unknown` and `prompt` mean the browser could not tell us what happened.
 * The recovery for both is "try again", which is what the unavailable copy
 * says, so they land there rather than in `denied`.
 */
function toMicOutcome(state: MicPermissionState): MicOutcome {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'unavailable';
  }
}

/**
 * First run after login: name, appearance, microphone.
 *
 * Only step 1 is blocking. The name is the server-side "onboarding done"
 * flag that `RequireProfile` reads, so this route must stay outside that
 * guard or a user with no name would be redirected to itself forever.
 *
 * Steps 2 and 3 are client-side only. Step 3 must be a real button press:
 * on iOS Safari and inside a standalone PWA, `getUserMedia` called outside a
 * user gesture can be ignored without a word.
 */
export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const isOnline = useOnline();
  const { user } = useSession();
  const updateProfile = useUpdateProfile();
  const logout = useLogout();
  const [theme, setTheme] = useTheme();

  const [step, setStep] = useState<Step>(1);
  const [micOutcome, setMicOutcome] = useState<MicOutcome>('idle');

  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  const nameForm = useForm<ProfileNameValues>({
    resolver: zodResolver(profileNameSchema),
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    },
  });

  // Moves focus to the new title on each step change. Without it a keyboard
  // user stays on the button that is now gone, at the bottom of the page.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const submitName = nameForm.handleSubmit((values) => {
    updateProfile.mutate(values, {
      // The mutation writes the fresh user into the `me` cache, so
      // `RequireProfile` sees the new name with no refetch.
      onSuccess: () => setStep(2),
    });
  });

  const askForMicrophone = async () => {
    setMicOutcome('prompting');
    const state = await requestMicrophonePermission();
    setMicOutcome(toMicOutcome(state));
    dispatch(setMicPermissionAsked(true));
  };

  const skipMicrophone = () => {
    setMicOutcome('dismissed');
    dispatch(setMicPermissionAsked(true));
  };

  const finish = () => {
    navigate('/video', { replace: true });
  };

  const titleKey =
    step === 1
      ? 'onboarding.name.title'
      : step === 2
        ? 'onboarding.appearance.title'
        : 'onboarding.mic.title';

  const descriptionKey =
    step === 1
      ? 'onboarding.name.description'
      : step === 2
        ? 'onboarding.appearance.description'
        : 'onboarding.mic.description';

  return (
    <section className="stage-safe-top flex min-h-dvh w-full flex-col items-center justify-center px-4 pb-8">
      <div className="flex w-full max-w-sm flex-col gap-4 py-4">
        <div className="text-center">
          <p className="text-sm font-medium text-muted">
            {t('onboarding.title')}
          </p>
          {step === 1 ? (
            <p className="mt-1 text-sm text-muted">
              {t('onboarding.subtitle')}
            </p>
          ) : null}
        </div>

        {/* The step count is real text next to the bar, not colour alone. */}
        <ProgressBar
          aria-label={t('onboarding.progress')}
          value={step}
          minValue={0}
          maxValue={TOTAL_STEPS}
        >
          <ProgressBar.Output>
            {t('onboarding.stepOf', { current: step, total: TOTAL_STEPS })}
          </ProgressBar.Output>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>

        <Card>
          <Card.Header>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight text-foreground outline-none"
            >
              {t(titleKey)}
            </h1>
            <Card.Description>{t(descriptionKey)}</Card.Description>
          </Card.Header>

          <Card.Content>
            {step === 1 ? (
              <form
                onSubmit={submitName}
                noValidate
                className="flex flex-col gap-4"
              >
                <ProfileNameFields
                  control={nameForm.control}
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
                ) : null}

                <Button
                  type="submit"
                  isPending={updateProfile.isPending}
                  isDisabled={!isOnline}
                  className="min-h-11 w-full"
                >
                  {t('onboarding.next')}
                </Button>

                {/* The only way out for someone who typed the wrong number. */}
                <Button
                  type="button"
                  variant="ghost"
                  isPending={logout.isPending}
                  onPress={() =>
                    logout.mutate(undefined, {
                      onSettled: () => navigate('/login', { replace: true }),
                    })
                  }
                  className="min-h-11 self-center"
                >
                  {t('onboarding.logout')}
                </Button>
              </form>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-4">
                {/* Applied the moment it is picked, so the choice is its own preview. */}
                <RadioGroup
                  value={theme}
                  onChange={(value) => {
                    const option = THEME_OPTIONS.find(
                      (item) => item.value === value,
                    );
                    if (option) setTheme(option.value);
                  }}
                >
                  <Label className="sr-only">
                    {t('settings.appearance.label')}
                  </Label>
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

                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    onPress={() => setStep(1)}
                    className="min-h-11"
                  >
                    {t('onboarding.back')}
                  </Button>
                  <Button onPress={() => setStep(3)} className="min-h-11">
                    {t('onboarding.next')}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="flex flex-col gap-4">
                {micOutcome === 'granted' ? (
                  <InlineAlert status="success">
                    {t('onboarding.mic.granted')}
                  </InlineAlert>
                ) : null}
                {micOutcome === 'denied' ? (
                  <InlineAlert status="warning">
                    {t('onboarding.mic.denied')}
                  </InlineAlert>
                ) : null}
                {micOutcome === 'unavailable' ? (
                  <InlineAlert status="warning">
                    {t('onboarding.mic.unavailable')}
                  </InlineAlert>
                ) : null}
                {micOutcome === 'dismissed' ? (
                  <InlineAlert status="info">
                    {t('onboarding.mic.skipped')}
                  </InlineAlert>
                ) : null}

                {micOutcome === 'idle' || micOutcome === 'prompting' ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      isPending={micOutcome === 'prompting'}
                      onPress={() => void askForMicrophone()}
                      className="min-h-11 w-full"
                    >
                      {t('onboarding.mic.allow')}
                    </Button>
                    <Button
                      variant="ghost"
                      isDisabled={micOutcome === 'prompting'}
                      onPress={skipMicrophone}
                      className="min-h-11 w-full"
                    >
                      {t('onboarding.mic.later')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {/*
                     * The unavailable copy tells the user to close the other app
                     * and try again, so the ask has to stay reachable. A denied
                     * microphone is sticky at the OS level: asking again there
                     * fails without a dialog, so that state gets no retry.
                     */}
                    {micOutcome === 'unavailable' ? (
                      <Button
                        variant="secondary"
                        onPress={() => void askForMicrophone()}
                        className="min-h-11 w-full"
                      >
                        {t('onboarding.mic.allow')}
                      </Button>
                    ) : null}
                    <Button onPress={finish} className="min-h-11 w-full">
                      {t('onboarding.finish')}
                    </Button>
                  </div>
                )}

                <Button
                  variant="secondary"
                  isDisabled={micOutcome === 'prompting'}
                  onPress={() => setStep(2)}
                  className="min-h-11 self-start"
                >
                  {t('onboarding.back')}
                </Button>
              </div>
            ) : null}
          </Card.Content>
        </Card>
      </div>
    </section>
  );
}

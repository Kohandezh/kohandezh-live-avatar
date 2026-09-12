import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { User } from '@/entities/user';
import { isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import {
  TextField,
  Label,
  Input,
  Description,
  FieldError,
  InputOTP,
} from '@heroui/react';
import { Button, InlineAlert } from '@/shared/ui';
import { useRequestOtp, useVerifyOtp } from './hooks';
import { codeSchema, phoneSchema, toAsciiDigits } from './schemas';

const phoneFormSchema = z.object({ phone: phoneSchema });
type PhoneFormValues = z.infer<typeof phoneFormSchema>;

const codeFormSchema = z.object({ code: codeSchema });
type CodeFormValues = z.infer<typeof codeFormSchema>;

/** How many digits the one-time code has. Drives the slot count and `maxLength`. */
const CODE_LENGTH = 6;
const CODE_SLOTS = [0, 1, 2, 3, 4, 5];

/**
 * The OTP boxes are not inside a `TextField`, so nothing links a message to them
 * automatically. These ids do it by hand through `aria-describedby`.
 */
const CODE_ERROR_ID = 'code-error';
const CODE_HINT_ID = 'code-hint';

interface OtpErrorDetails {
  retryAfterSeconds?: number;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Maps a failed OTP request/verify call to a user-facing, translated message. */
function describeAuthError(t: Translate, error: unknown): string {
  if (!isApiError(error)) return t('auth.errors.failed');
  if (error.isNetworkError) return t('auth.errors.offline');

  const details = error.details as OtpErrorDetails | undefined;

  switch (error.serverCode) {
    case 'invalid_code':
      return t('auth.errors.wrongCode');
    case 'otp_expired':
      return t('auth.errors.otpExpired');
    case 'otp_locked':
      return t('auth.errors.otpLocked', {
        seconds: details?.retryAfterSeconds ?? 0,
      });
    case 'otp_rate_limited':
      return t('auth.errors.otpRateLimited', {
        seconds: details?.retryAfterSeconds ?? 0,
      });
    case 'account_disabled':
      return t('auth.errors.accountDisabled');
    default:
      return t('auth.errors.failed');
  }
}

/**
 * Two-step phone login: request a one-time code, then verify it.
 * Shared by every app target (mobile, web, admin).
 */
export function PhoneLoginForm({
  onSuccess,
}: {
  onSuccess?: (user: User) => void;
}) {
  const { t } = useTranslation();
  const isOnline = useOnline();
  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** Counts rejected codes. Only used to move focus back after each failure. */
  const [failedAttempts, setFailedAttempts] = useState(0);

  const phoneForm = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { phone: '' },
  });

  const codeForm = useForm<CodeFormValues>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  /**
   * The last code the form auto-submitted. The backend locks the number after five
   * wrong codes, so a repeated auto-submit of the same value could lock a user out
   * of their own phone in seconds. Reset to null whenever a fresh attempt is valid.
   */
  const submittedRef = useRef<string | null>(null);

  // Ticks the resend countdown down to zero, one second at a time.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  // Moves focus to the code field as soon as step 2 appears.
  useEffect(() => {
    if (step === 'code') {
      codeForm.setFocus('code');
    }
    // codeForm is a stable object from useForm; only `step` should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Moves focus back to the empty boxes after a rejected code. This has to be an
  // effect, not part of the mutation's onError: at that moment the input is still
  // rendered as disabled (the pending flag has not repainted yet) and a disabled
  // input cannot take focus.
  useEffect(() => {
    if (failedAttempts === 0) return;
    codeForm.setFocus('code');
    // codeForm is a stable object from useForm; only the counter should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedAttempts]);

  const submitPhone = phoneForm.handleSubmit((values) => {
    requestOtp.mutate(
      { phone: values.phone },
      {
        onSuccess: (data) => {
          setPhone(data.phone);
          setDevCode(data.devCode ?? null);
          setSecondsLeft(data.resendAfterSeconds);
          submittedRef.current = null;
          codeForm.reset({ code: '' });
          setStep('code');
        },
      },
    );
  });

  const submitCode = codeForm.handleSubmit((values) => {
    verifyOtp.mutate(
      { phone, code: values.code },
      {
        onSuccess: (data) => onSuccess?.(data.user),
        onError: () => {
          // Empty the boxes and re-arm the auto-submit. `onComplete` only fires on
          // the incomplete -> complete edge, so the value has to drop below six
          // before a retry can trigger it again.
          submittedRef.current = null;
          codeForm.reset({ code: '' });
          setFailedAttempts((count) => count + 1);
        },
      },
    );
  });

  /**
   * Auto-submit once the sixth digit lands (requirement 12). Every guard here
   * exists to stop a second call for the same attempt.
   */
  const handleComplete = (code: string) => {
    if (!isOnline) return; // never auto-submit offline
    if (verifyOtp.isPending) return; // a call is already in flight
    if (submittedRef.current === code) return; // this exact code was already sent
    submittedRef.current = code;
    void submitCode(); // the same handler the Verify button runs
  };

  const resend = () => {
    requestOtp.mutate(
      { phone },
      {
        onSuccess: (data) => {
          setDevCode(data.devCode ?? null);
          setSecondsLeft(data.resendAfterSeconds);
          // The old code stopped working, so the boxes must not keep showing it.
          submittedRef.current = null;
          verifyOtp.reset();
          codeForm.reset({ code: '' });
        },
      },
    );
  };

  const changeNumber = () => {
    setStep('phone');
    setDevCode(null);
    setSecondsLeft(0);
    // Both mutations are reset. Step 1 also renders `requestOtp` errors, so a
    // failed resend would otherwise greet the user with a stale message there.
    verifyOtp.reset();
    requestOtp.reset();
    submittedRef.current = null;
    codeForm.reset({ code: '' });
  };

  if (step === 'phone') {
    const phoneError = phoneForm.formState.errors.phone?.message;

    return (
      <form onSubmit={submitPhone} noValidate className="flex flex-col gap-4">
        <TextField isInvalid={Boolean(phoneError)} validationBehavior="aria" fullWidth>
          <Label>{t('auth.phone')}</Label>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            {...phoneForm.register('phone')}
          />
          {phoneError ? (
            <FieldError>{t(phoneError)}</FieldError>
          ) : (
            <Description>{t('auth.phoneHint')}</Description>
          )}
        </TextField>

        {!isOnline ? (
          <InlineAlert status="warning">{t('auth.errors.offline')}</InlineAlert>
        ) : requestOtp.isError ? (
          <InlineAlert status="danger">
            {describeAuthError(t, requestOtp.error)}
          </InlineAlert>
        ) : null}

        <Button
          type="submit"
          isPending={requestOtp.isPending}
          isDisabled={!isOnline}
          className="mt-2 w-full"
        >
          {t('auth.sendCode')}
        </Button>
      </form>
    );
  }

  const codeError = codeForm.formState.errors.code?.message;
  // While on step 2, a failed resend and a failed verify both surface here.
  // Verify is the user's most recent intent, so it wins when both are set.
  const stepError = verifyOtp.isError
    ? describeAuthError(t, verifyOtp.error)
    : requestOtp.isError
      ? describeAuthError(t, requestOtp.error)
      : null;

  return (
    <form onSubmit={submitCode} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {/* The number is Latin digits with a leading plus; bdi keeps it in one piece in RTL. */}
        <Trans
          i18nKey="auth.codeSentTo"
          values={{ phone }}
          components={{ phone: <bdi dir="ltr" /> }}
        />
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">{t('auth.code')}</p>

        {/*
         * The dir="ltr" wrapper is required, not cosmetic. A `dir` prop on InputOTP
         * reaches only the hidden real input, never the visible slot row, so under
         * the Persian RTL locale the six boxes would fill right to left and show the
         * digits in the wrong order.
         */}
        <div dir="ltr" className="flex justify-center">
          <Controller
            control={codeForm.control}
            name="code"
            render={({ field, fieldState }) => (
              <InputOTP
                // HeroUI's own class stretches the row to the full width and packs
                // the boxes at the start edge. This centres them instead.
                className="justify-center"
                // Controller only learns the focus target from field.ref, and
                // codeForm.setFocus('code') depends on it.
                ref={field.ref}
                name={field.name}
                value={field.value}
                onBlur={field.onBlur}
                // InputOTP hands onChange a raw string, not an event, which is why
                // register() cannot drive it. Converting Persian and Arabic-Indic
                // digits here keeps the boxes, onComplete and zod all on ASCII.
                onChange={(next) => field.onChange(toAsciiDigits(next))}
                onComplete={handleComplete}
                maxLength={CODE_LENGTH}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                // No TextField wraps this, so a neighbouring Label would not be
                // associated with the input. The name has to be passed by hand.
                aria-label={t('auth.code')}
                aria-describedby={codeError ? CODE_ERROR_ID : CODE_HINT_ID}
                isInvalid={fieldState.invalid || verifyOtp.isError}
                isDisabled={verifyOtp.isPending || !isOnline}
              >
                <InputOTP.Group>
                  {CODE_SLOTS.slice(0, 3).map((index) => (
                    <InputOTP.Slot key={index} index={index} className="h-11" />
                  ))}
                </InputOTP.Group>
                <InputOTP.Separator />
                <InputOTP.Group>
                  {CODE_SLOTS.slice(3).map((index) => (
                    <InputOTP.Slot key={index} index={index} className="h-11" />
                  ))}
                </InputOTP.Group>
              </InputOTP>
            )}
          />
        </div>

        {/*
         * A plain paragraph, not <FieldError>. HeroUI mounts FieldErrorContext inside
         * InputOTP around the hidden input only, so a FieldError placed next to the
         * boxes finds no context and renders nothing at all.
         */}
        {codeError ? (
          <p id={CODE_ERROR_ID} role="alert" className="px-1 text-xs text-danger">
            {t(codeError)}
          </p>
        ) : (
          <p id={CODE_HINT_ID} className="px-1 text-xs text-muted">
            {t('auth.codeHint')}
          </p>
        )}
      </div>

      {/* Auto-submit presses no button, so a screen reader would otherwise hear nothing. */}
      <p className="sr-only" role="status" aria-live="polite">
        {verifyOtp.isPending ? t('auth.checkingCode') : ''}
      </p>

      {devCode ? (
        <InlineAlert status="info">
          {t('auth.devCodeHint', { code: devCode })}
        </InlineAlert>
      ) : null}

      {!isOnline ? (
        <InlineAlert status="warning">{t('auth.errors.offline')}</InlineAlert>
      ) : stepError ? (
        <InlineAlert status="danger">{stepError}</InlineAlert>
      ) : null}

      <Button
        type="submit"
        isPending={verifyOtp.isPending}
        isDisabled={!isOnline}
        className="w-full"
      >
        {t('auth.verify')}
      </Button>

      <div className="flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={changeNumber}
          className="min-h-11 font-medium text-foreground underline underline-offset-4 hover:text-accent"
        >
          {t('auth.changeNumber')}
        </button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          isPending={requestOtp.isPending}
          isDisabled={!isOnline || secondsLeft > 0}
          onPress={resend}
        >
          {secondsLeft > 0
            ? t('auth.resendIn', { seconds: secondsLeft })
            : t('auth.resend')}
        </Button>
      </div>
    </form>
  );
}

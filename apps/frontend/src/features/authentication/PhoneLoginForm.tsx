import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { User } from '@/entities/user';
import { isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { TextField, Label, Input, Description, FieldError } from '@heroui/react';
import { Button, InlineAlert } from '@/shared/ui';
import { useRequestOtp, useVerifyOtp } from './hooks';
import { codeSchema, phoneSchema } from './schemas';

const phoneFormSchema = z.object({ phone: phoneSchema });
type PhoneFormValues = z.infer<typeof phoneFormSchema>;

const codeFormSchema = z.object({ code: codeSchema });
type CodeFormValues = z.infer<typeof codeFormSchema>;

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

  const phoneForm = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { phone: '' },
  });

  const codeForm = useForm<CodeFormValues>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

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

  const submitPhone = phoneForm.handleSubmit((values) => {
    requestOtp.mutate(
      { phone: values.phone },
      {
        onSuccess: (data) => {
          setPhone(data.phone);
          setDevCode(data.devCode ?? null);
          setSecondsLeft(data.resendAfterSeconds);
          codeForm.reset({ code: '' });
          setStep('code');
        },
      },
    );
  });

  const submitCode = codeForm.handleSubmit((values) => {
    verifyOtp.mutate(
      { phone, code: values.code },
      { onSuccess: (data) => onSuccess?.(data.user) },
    );
  });

  const resend = () => {
    requestOtp.mutate(
      { phone },
      {
        onSuccess: (data) => {
          setDevCode(data.devCode ?? null);
          setSecondsLeft(data.resendAfterSeconds);
        },
      },
    );
  };

  const changeNumber = () => {
    setStep('phone');
    setDevCode(null);
    setSecondsLeft(0);
    verifyOtp.reset();
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
      <p className="text-sm text-slate-600">
        {/* The number is Latin digits with a leading plus; bdi keeps it in one piece in RTL. */}
        <Trans
          i18nKey="auth.codeSentTo"
          values={{ phone }}
          components={{ phone: <bdi dir="ltr" /> }}
        />
      </p>

      <TextField isInvalid={Boolean(codeError)} validationBehavior="aria" fullWidth>
        <Label>{t('auth.code')}</Label>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          {...codeForm.register('code')}
        />
        {codeError ? <FieldError>{t(codeError)}</FieldError> : null}
      </TextField>

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
          className="font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
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

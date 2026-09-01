import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, TextField } from '@shared/ui';
import { ApiError } from '@shared/api';
import { useLogin } from './useSession';

// Client-side validation is for UX only; the backend validates again (Security §16).
const schema = z.object({ email: z.string().email(), password: z.string().min(6) });

export function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const { t } = useTranslation();
  const login = useLogin();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<{ email?: string | undefined; password?: string | undefined }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data, { onSuccess: () => onSuccess?.() });
  }

  const serverError =
    login.isError && login.error instanceof ApiError && login.error.code === 'UNAUTHORIZED'
      ? t('auth.invalid')
      : login.isError
        ? t('state.error')
        : undefined;

  return (
    <form onSubmit={submit} noValidate aria-busy={login.isPending}>
      <TextField
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        dir="ltr"
        value={values.email}
        onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        error={fieldErrors.email}
        required
      />
      <TextField
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        dir="ltr"
        value={values.password}
        onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        error={fieldErrors.password}
        required
      />
      {serverError && (
        <p role="alert" className="state--error">
          {serverError}
        </p>
      )}
      <Button type="submit" variant="primary" loading={login.isPending}>
        {login.isPending ? t('auth.submitting') : t('auth.submit')}
      </Button>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9em' }}>{t('auth.hint')}</p>
    </form>
  );
}

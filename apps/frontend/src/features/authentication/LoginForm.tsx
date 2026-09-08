import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { User } from '@/entities/user';
import { isUnauthorized } from '@/shared/api';
import { env } from '@/shared/config/env';
import { Button, Input } from '@/shared/ui';
import { useLogin } from './hooks';
import { loginSchema, type LoginInput } from './schemas';

export function LoginForm({ onSuccess }: { onSuccess?: (user: User) => void }) {
  const { t } = useTranslation();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: (data) => onSuccess?.(data.user),
    });
  });

  const serverError = login.error
    ? isUnauthorized(login.error)
      ? t('auth.errors.invalidCredentials')
      : t('auth.errors.failed')
    : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message ? t(errors.email.message) : undefined}
        {...register('email')}
      />
      <Input
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        error={
          errors.password?.message ? t(errors.password.message) : undefined
        }
        {...register('password')}
      />

      {serverError ? (
        <p role="alert" className="text-sm text-red-600">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" loading={login.isPending} className="mt-2 w-full">
        {t('auth.submit')}
      </Button>

      {env.apiMock ? (
        <p className="text-center text-xs text-slate-500">
          {t('auth.demoHint')}
        </p>
      ) : null}
    </form>
  );
}

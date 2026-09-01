import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoginForm } from '@features/authentication';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <h1>{t('nav.login')}</h1>
      <LoginForm onSuccess={() => navigate('/profile', { replace: true })} />
    </>
  );
}

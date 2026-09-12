import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PhoneLoginForm, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { LoadingState } from '@/shared/ui';

/**
 * The first screen of the app. Shared by every app target. After login it returns
 * the user to the page that redirected them (location.state.from) or to `redirectTo`.
 */
export function LoginPage({ redirectTo = '/' }: { redirectTo?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading } = useSession();

  const from = (location.state as { from?: string } | null)?.from ?? redirectTo;

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return (
    // This is the first screen a user sees, before RequireAuth and before any layout
    // header, so it has to carry its own safe area instead of borrowing one from a
    // parent. `stage-safe-top` keeps the product name clear of a notch or the status
    // bar (same choice `OnboardingPage` already makes for the same kind of centered,
    // header-less screen). `safe-inline-gutter` is the horizontal case nobody had
    // covered: in landscape on a notched phone, or on an Android camera-cutout device,
    // the cutout moves to one side, and a plain `px-4` does not know about it. Both come
    // from `src/styles/globals.css`; nothing new was added here. `pb-8` (not `safe-bottom`)
    // stays fixed on purpose: it already clears a home indicator on every device that has
    // one, and stacking it with `safe-bottom` on the same `padding-bottom` property would
    // just leave one of the two rules to win by accident. The keyboard-open case needs no
    // CSS at all: the shell's own `<main>` (WebLayout / MobileLayout) is already
    // `overflow-y-auto`, so a shorter visual viewport scrolls instead of clipping.
    <section className="stage-safe-top safe-inline-gutter mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 pb-8">
      {/*
       * The product name stays. This screen is now the first thing a new user sees,
       * and a bare phone-number form with no product name reads as a phishing page.
       * The requirement removed the brand from the header, which is gone anyway.
       */}
      <div className="flex flex-col gap-2 text-center">
        <p className="text-sm font-medium text-muted">{t('app.name')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('auth.title')}
        </h1>
        <p className="text-sm text-muted">{t('auth.subtitle')}</p>
      </div>

      <PhoneLoginForm onSuccess={() => navigate(from, { replace: true })} />

      {/*
       * The only language control outside /settings, and it has to be here. Settings
       * sits behind RequireAuth, so a Persian speaker who lands on an English login
       * screen would otherwise have no way to switch before signing in.
       */}
      <div className="flex justify-center">
        <LanguageSwitcher />
      </div>
    </section>
  );
}

import { useTranslation } from 'react-i18next';
import type { AssistantLanguage } from '@/entities/assistant-session';
import {
  Card,
  ErrorState,
  InlineAlert,
  StatusChip,
  type StatusTone,
} from '@/shared/ui';
import { cn } from '@/shared/utils';
import { AssistantControls } from './AssistantControls';
import { AssistantVideo } from './AssistantVideo';
import { AssistantVoiceView } from './AssistantVoiceView';
import { Transcript } from './Transcript';
import { useAssistantSession } from './useAssistantSession';
import type { AssistantConnectionQuality, AssistantMode } from './types';

const QUALITY_TONE: Record<AssistantConnectionQuality, StatusTone> = {
  unknown: 'default',
  good: 'success',
  bad: 'warning',
};

export interface AssistantPanelProps {
  /** Language for the avatar. Defaults to the language the interface is showing. */
  language?: AssistantLanguage;
  /** Which view the conversation opens in. Defaults to video. */
  initialMode?: AssistantMode;
  className?: string;
}

/**
 * The whole assistant experience in one component: it owns the single session and is shared
 * by the mobile app, the web PWA, and the website widget.
 */
export function AssistantPanel({
  language,
  initialMode,
  className,
}: AssistantPanelProps) {
  const { t, i18n } = useTranslation();
  const uiLanguage: AssistantLanguage = i18n.language.startsWith('fa')
    ? 'fa'
    : 'en';
  const controller = useAssistantSession({
    language: language ?? uiLanguage,
    initialMode,
  });

  const {
    status,
    mode,
    session,
    error,
    endReason,
    online,
    connectionQuality,
    transcript,
  } = controller;

  return (
    <Card className={cn('flex flex-col gap-4', className)}>
      {/* The page (or the widget host) owns the heading, so the card only carries state. */}
      {session && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {session.sandbox && (
            <StatusChip tone="accent">{t('assistant.sandbox')}</StatusChip>
          )}
          {/*
            The ElevenLabs agent always answers in its own language, so there is nothing to
            fall back from. A chip tells the user which language to speak.
          */}
          {session.agentType === 'elevenlabs' && (
            <StatusChip>
              {t('assistant.agentLanguage', {
                language: t(`assistant.languages.${session.language}`),
              })}
            </StatusChip>
          )}
          {status === 'connected' && (
            <StatusChip tone={QUALITY_TONE[connectionQuality]}>
              {t(`assistant.quality.${connectionQuality}`)}
            </StatusChip>
          )}
        </div>
      )}

      {!online && (
        <InlineAlert status="warning">{t('assistant.offline')}</InlineAlert>
      )}

      {/* Only FULL mode can fall back: it is the path that cannot start a Persian session. */}
      {session?.agentType === 'full' &&
        session.language !== session.requestedLanguage && (
          <InlineAlert status="info">
            {t('assistant.languageFallback', {
              language: t(`assistant.languages.${session.language}`),
            })}
          </InlineAlert>
        )}

      {status === 'error' && error && (
        <div>
          <ErrorState
            className="py-6"
            title={t('assistant.errors.title')}
            description={t(`assistant.errors.${error.kind}`)}
            onRetry={
              controller.canStart ? () => void controller.start() : undefined
            }
          />
          {error.code && (
            <p dir="ltr" className="text-center text-xs text-slate-400">
              {t('assistant.errors.code', { code: error.code })}
            </p>
          )}
        </div>
      )}

      {status !== 'error' && error && (
        <InlineAlert status="danger">
          {t(`assistant.errors.${error.kind}`)}
        </InlineAlert>
      )}

      {status === 'ended' && endReason && (
        <InlineAlert status="info" title={t('assistant.ended.title')}>
          {t(`assistant.ended.${endReason}`)}
        </InlineAlert>
      )}

      {/*
        The video element is never unmounted: in voice mode it only leaves the screen, so the
        avatar audio keeps playing and switching modes does not reconnect the session.
      */}
      <div
        className={mode === 'voice' ? 'sr-only' : undefined}
        aria-hidden={mode === 'voice'}
      >
        <AssistantVideo controller={controller} />
      </div>
      {mode === 'voice' && <AssistantVoiceView controller={controller} />}

      <AssistantControls controller={controller} />

      <Transcript turns={transcript} />
    </Card>
  );
}

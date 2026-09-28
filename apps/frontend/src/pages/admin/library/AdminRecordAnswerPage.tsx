import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, buttonVariants } from '@heroui/react';
import { useAppDispatch, useAppSelector } from '@/app/store';
import {
  libraryEntryKeys,
  useChangeLibraryEntryStatus,
  useLibraryEntryByKey,
  type AdminLibraryEntry,
} from '@/entities/library-entry';
import {
  AvatarSessionPanel,
  selectActiveSessionId,
  selectSessionTransport,
} from '@/features/avatar-session';
import { DiagnosticsPanel } from '@/features/diagnostics';
import {
  RecordingControls,
  recordingReset,
  selectRecording,
  selectRecordingActive,
} from '@/features/recording';
import {
  TtsComposer,
  selectComposerText,
  selectLastAudio,
} from '@/features/text-to-speech';
import { isApiError } from '@/shared/api';
import { Button, ErrorState, InlineAlert, LoadingState } from '@/shared/ui';
import { ReadOnlyText } from './EntryFields';
import { libraryErrorKey, normalizeSpokenText } from './libraryText';
import { SaveToLibraryForm } from './SaveToLibraryForm';
import { UnsavedRecordings } from './UnsavedRecordings';

/**
 * The longest answer audio one recording takes (REQ-036): a LiveAvatar session lasts 300 s, and
 * 30 s stay free for connecting and stopping Egress. A chosen margin, not a measurement.
 */
const MAX_RECORDING_AUDIO_MS = 270_000;

/** How the library page is told which entry to open, through the router's location state. */
export interface OpenEntryState {
  openEntry: AdminLibraryEntry;
}

/**
 * Record answer (REQ-034): the four workbench features, composed as the old `/avatar` page did.
 * Opened empty, a finished recording is saved as a new `draft` entry. Opened from a `ready` entry
 * (`?entry=<id>&key=<key>`, REQ-074), the entry's approved text is spoken read only and the video
 * is attached to that entry.
 */
export function AdminRecordAnswerPage() {
  const { t } = useTranslation('admin');
  const [params] = useSearchParams();
  const entryId = params.get('entry');
  const entryKey = params.get('key');
  const entryRef =
    entryId !== null ? { id: entryId, key: entryKey ?? '' } : null;
  const entry = useLibraryEntryByKey(entryRef);

  let body;
  if (entryRef === null) {
    body = <RecordAnswer entry={null} />;
  } else if (entry.isPending) {
    body = <LoadingState />;
  } else if (entry.isError) {
    if (isApiError(entry.error) && entry.error.status === 403) {
      return <Navigate to="/forbidden" replace />;
    }
    body = <ErrorState onRetry={() => void entry.refetch()} />;
  } else if (entry.data.status !== 'ready' || entry.data.answerText === null) {
    // Another admin moved the entry on meanwhile, so there is nothing to record for it.
    body = (
      <InlineAlert status="warning" title={t('library.errors.statusChanged')} />
    );
  } else {
    body = (
      <RecordAnswer
        entry={{ ...entry.data, answerText: entry.data.answerText }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('library.record.title')}
        </h1>
        <Link
          to="/library"
          className={buttonVariants({ variant: 'secondary' })}
        >
          {t('nav.library')}
        </Link>
      </header>
      {body}
    </section>
  );
}

type ReadyEntry = AdminLibraryEntry & { answerText: string };

function RecordAnswer({ entry }: { entry: ReadyEntry | null }) {
  const { t } = useTranslation('admin');
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const draft = useAppSelector(selectComposerText);
  const lastAudio = useAppSelector(selectLastAudio);
  const sessionId = useAppSelector(selectActiveSessionId);
  const transport = useAppSelector(selectSessionTransport);
  const recordingActive = useAppSelector(selectRecordingActive);
  const recording = useAppSelector(selectRecording);

  // While a recording runs, the composer shows the text it records and Send to avatar speaks it,
  // so the video says the text that was checked (REQ-003, REQ-036, ruling 10).
  const recordedText =
    recordingActive || recording.status === 'starting'
      ? recording.recordedText
      : null;
  const lockedText = entry?.answerText ?? recordedText ?? undefined;
  const text = lockedText ?? draft;
  // The audio only counts while it is the audio of the text on screen. Without it the length is
  // unknown, so Record waits for it (REQ-036, ruling 5).
  const audio = lastAudio?.text === text ? lastAudio : null;
  const recordBlock =
    audio === null
      ? 'needsAudio'
      : audio.durationMs > MAX_RECORDING_AUDIO_MS
        ? 'tooLong'
        : null;
  const doneVideoId =
    recording.status === 'done' &&
    recording.result?.status === 'VIDEO_GENERATED'
      ? recording.result.id
      : null;
  // In entry mode only a recording of the entry's own text counts (ruling 7): the slice may still
  // hold another answer's recording from earlier in this tab.
  const isResultForThisScreen =
    entry === null ||
    normalizeSpokenText(recording.recordedText ?? '') ===
      normalizeSpokenText(entry.answerText);
  const finishedVideoId = isResultForThisScreen ? doneVideoId : null;

  // A finished recording joins the unsaved list at once, so it is there after a reload too.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (doneVideoId)
      void queryClient.invalidateQueries({ queryKey: libraryEntryKeys.all });
  }, [doneVideoId, queryClient]);

  function openEntry(saved: AdminLibraryEntry, fromThisRecording: boolean) {
    if (fromThisRecording) dispatch(recordingReset());
    const state: OpenEntryState = { openEntry: saved };
    navigate('/library', { state });
  }

  return (
    <>
      {/* One line above the steps: what recording costs (REQ-039). */}
      <InlineAlert status="info">
        {t('library.record.needsAccounts')}
      </InlineAlert>

      {entry ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {t('library.panel.title', { key: entry.key })}
          </p>
          <ReadOnlyText label={t('library.fields.question')}>
            {entry.question}
          </ReadOnlyText>
        </Card>
      ) : null}

      {/* The workflow order on every width (ruling 8): text, avatar session, recording, then
          save or attach. Two columns on a wide screen keep the same reading order. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <TtsComposer lockedText={lockedText} />
        <AvatarSessionPanel text={text} recordingActive={recordingActive} />
        <RecordingControls
          sessionId={sessionId}
          text={text}
          audioAssetId={audio?.id ?? null}
          transport={transport}
          recordBlock={recordBlock}
          isResultForThisScreen={isResultForThisScreen}
        />
        {entry ? (
          <AttachToEntry
            entry={entry}
            videoAssetId={finishedVideoId}
            isOtherAnswer={doneVideoId !== null && !isResultForThisScreen}
            onAttached={(attached) => openEntry(attached, true)}
          />
        ) : (
          <Card>
            <h2 className="mb-4 text-base font-semibold text-foreground">
              {t('library.record.save')}
            </h2>
            <SaveToLibraryForm
              videoAssetId={finishedVideoId}
              onSaved={(saved) => openEntry(saved, true)}
            />
          </Card>
        )}
      </div>

      <UnsavedRecordings
        onOpenEntry={(saved) =>
          openEntry(saved, saved.videoAssetId === doneVideoId)
        }
      />

      <DiagnosticsPanel />
    </>
  );
}

/** Attach to this answer (REQ-074): the finished video joins the `ready` entry (REQ-068). */
function AttachToEntry({
  entry,
  videoAssetId,
  isOtherAnswer,
  onAttached,
}: {
  entry: ReadyEntry;
  videoAssetId: string | null;
  /** The finished recording speaks another answer's text, so it cannot join this one. */
  isOtherAnswer: boolean;
  onAttached: (entry: AdminLibraryEntry) => void;
}) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const changeStatus = useChangeLibraryEntryStatus();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const hintId = useId();

  async function attach() {
    if (!videoAssetId) return;
    setErrorKey(null);
    try {
      onAttached(
        await changeStatus.mutateAsync({
          id: entry.id,
          input: { status: 'draft', videoAssetId, fromStatus: 'ready' },
        }),
      );
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        navigate('/forbidden', { replace: true });
        return;
      }
      setErrorKey(libraryErrorKey(error));
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      {errorKey ? <InlineAlert status="danger" title={t(errorKey)} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {isOtherAnswer ? (
          <p id={hintId} className="flex-1 text-sm text-muted">
            {t('library.record.otherAnswer')}
          </p>
        ) : null}
        <Button
          variant="primary"
          className="min-h-11 md:min-h-9"
          aria-describedby={isOtherAnswer ? hintId : undefined}
          isDisabled={videoAssetId === null}
          isPending={changeStatus.isPending}
          onPress={() => void attach()}
        >
          {t('library.record.attach')}
        </Button>
      </div>
    </Card>
  );
}

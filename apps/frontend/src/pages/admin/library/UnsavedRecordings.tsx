import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, Modal } from '@heroui/react';
import {
  useChangeLibraryEntryStatus,
  useLibraryRecordings,
  useReadyLibraryEntries,
  type AdminLibraryEntry,
  type LibraryRecording,
} from '@/entities/library-entry';
import { formatNumber } from '@/i18n';
import { isApiError } from '@/shared/api';
import { Button, ErrorState, InlineAlert, LoadingState } from '@/shared/ui';
import { libraryErrorKey, normalizeSpokenText } from './libraryText';
import { SaveToLibraryForm } from './SaveToLibraryForm';

const PAGE_SIZE = 10;

/**
 * Finished recordings that no entry uses yet (REQ-042), so a recording is never lost to a reload,
 * a closed tab or a poll that stopped. Each one can be saved as a new entry, or attached to a
 * `ready` entry whose approved text is the recording's text (REQ-068). With none, nothing renders.
 */
export function UnsavedRecordings({
  onOpenEntry,
}: {
  onOpenEntry: (entry: AdminLibraryEntry) => void;
}) {
  const { t } = useTranslation('admin');
  const headingId = useId();
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState<LibraryRecording | null>(null);
  const recordings = useLibraryRecordings({ page, pageSize: PAGE_SIZE });
  const readyEntries = useReadyLibraryEntries();

  if (recordings.data && recordings.data.total === 0) return null;
  const pages = recordings.data
    ? Math.max(1, Math.ceil(recordings.data.total / recordings.data.pageSize))
    : 1;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {t('library.record.unsaved')}
      </h2>

      {recordings.isPending ? (
        <LoadingState />
      ) : recordings.isError ? (
        <ErrorState onRetry={() => void recordings.refetch()} />
      ) : (
        <>
          {readyEntries.isError ? (
            <ErrorState onRetry={() => void readyEntries.refetch()} />
          ) : null}
          <ul className="flex flex-col gap-3">
            {recordings.data.items.map((recording) => (
              <RecordingRow
                key={recording.videoAssetId}
                recording={recording}
                matches={(readyEntries.data ?? []).filter(
                  (entry) =>
                    entry.answerText !== null &&
                    normalizeSpokenText(entry.answerText) ===
                      normalizeSpokenText(recording.answerText),
                )}
                onSave={() => setSaving(recording)}
                onAttached={onOpenEntry}
              />
            ))}
          </ul>
          {pages > 1 ? (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-8"
                isDisabled={page <= 1}
                onPress={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('library.pagination.previous')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 md:min-h-8"
                isDisabled={page >= pages}
                onPress={() =>
                  setPage((current) => Math.min(pages, current + 1))
                }
              >
                {t('library.pagination.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal.Backdrop
        isOpen={saving !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSaving(null);
        }}
      >
        <Modal.Container scroll="inside">
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('library.record.save')}</Modal.Heading>
              {saving ? (
                <p dir="auto" className="text-sm text-muted">
                  {saving.answerText}
                </p>
              ) : null}
            </Modal.Header>
            <Modal.Body>
              {saving ? (
                <SaveToLibraryForm
                  key={saving.videoAssetId}
                  videoAssetId={saving.videoAssetId}
                  onSaved={(entry) => {
                    setSaving(null);
                    onOpenEntry(entry);
                  }}
                />
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </section>
  );
}

function RecordingRow({
  recording,
  matches,
  onSave,
  onAttached,
}: {
  recording: LibraryRecording;
  matches: readonly AdminLibraryEntry[];
  onSave: () => void;
  onAttached: (entry: AdminLibraryEntry) => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const navigate = useNavigate();
  const changeStatus = useChangeLibraryEntryStatus();
  const [attaching, setAttaching] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function attach(entry: AdminLibraryEntry) {
    setErrorKey(null);
    setAttaching(entry.id);
    try {
      const attached = await changeStatus.mutateAsync({
        id: entry.id,
        input: {
          status: 'draft',
          videoAssetId: recording.videoAssetId,
          fromStatus: 'ready',
        },
      });
      onAttached(attached);
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        navigate('/forbidden', { replace: true });
        return;
      }
      setErrorKey(libraryErrorKey(error));
    } finally {
      setAttaching(null);
    }
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-4">
        {errorKey ? <InlineAlert status="danger" title={t(errorKey)} /> : null}
        <p dir="auto" className="text-sm whitespace-pre-wrap text-foreground">
          {recording.answerText}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted">
            {t('library.duration', {
              seconds: formatNumber(
                Math.round(recording.durationMs / 1000),
                i18n.language,
              ),
            })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11 md:min-h-8"
            onPress={onSave}
          >
            {t('library.record.save')}
          </Button>
        </div>
        {matches.map((entry) => (
          <AttachMatch
            key={entry.id}
            entry={entry}
            isPending={attaching === entry.id}
            isDisabled={attaching !== null}
            onAttach={() => void attach(entry)}
          />
        ))}
      </Card>
    </li>
  );
}

/** One `ready` entry the recording says the approved text of: its question, key and Attach. */
function AttachMatch({
  entry,
  isPending,
  isDisabled,
  onAttach,
}: {
  entry: AdminLibraryEntry;
  isPending: boolean;
  isDisabled: boolean;
  onAttach: () => void;
}) {
  const { t } = useTranslation('admin');
  const questionId = useId();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-secondary p-3">
      <p id={questionId} className="text-sm text-foreground">
        <bdi>{entry.question}</bdi>{' '}
        <span dir="ltr" className="text-muted">
          ({entry.key})
        </span>
      </p>
      <Button
        size="sm"
        variant="primary"
        className="min-h-11 md:min-h-8"
        aria-describedby={questionId}
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onAttach}
      >
        {t('library.record.attach')}
      </Button>
    </div>
  );
}

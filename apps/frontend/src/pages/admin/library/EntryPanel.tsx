import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertDialog, Chip, Drawer, toast } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  libraryEntryKeys,
  useChangeLibraryEntryStatus,
  useLibraryEntry,
  useUpdateLibraryEntry,
  type AdminLibraryEntry,
  type LibraryStatus,
  type UpdateLibraryEntryInput,
} from '@/entities/library-entry';
import { formatNumber } from '@/i18n';
import { isApiError } from '@/shared/api';
import { Button, InlineAlert } from '@/shared/ui';
import {
  LabelFields,
  QuestionField,
  ReadOnlyText,
  SpokenAnswerEditor,
  UnsavedText,
} from './EntryFields';
import {
  formValuesOf,
  isBlank,
  type EntryField,
  type EntryFormValues,
} from './entryForm';
import { EntryVideo } from './EntryVideo';
import {
  HARD_LIMIT,
  libraryErrorKey,
  normalizeSpokenText,
  STATUS_COLOR,
} from './libraryText';

type Action =
  | 'save'
  | 'markReady'
  | 'reopen'
  | 'record'
  | 'publish'
  | 'reject'
  | 'unpublish'
  | 'withdraw';

/** The status each action asks for, through the one status route (REQ-065). */
const ACTION_TARGET: Record<Exclude<Action, 'save' | 'record'>, LibraryStatus> = {
  markReady: 'ready',
  reopen: 'pending',
  publish: 'published',
  reject: 'ready',
  unpublish: 'draft',
  withdraw: 'withdrawn',
};

/**
 * The actions of each status. An action the transition table would refuse is not rendered
 * (section 10). Record this answer (REQ-074) opens the Record answer screen with the entry.
 */
const STATUS_ACTIONS: Record<LibraryStatus, readonly Action[]> = {
  pending: ['save', 'withdraw', 'markReady'],
  ready: ['save', 'withdraw', 'reopen', 'record'],
  draft: ['save', 'withdraw', 'reject', 'publish'],
  published: ['withdraw', 'unpublish'],
  withdrawn: [],
};

/** The fields each status lets an admin edit in place (REQ-005). */
const EDITABLE: Record<LibraryStatus, readonly EntryField[]> = {
  pending: [
    'question',
    'answerText',
    'language',
    'category',
    'categoryTitle',
    'sectionType',
    'technical',
  ],
  ready: ['question', 'category', 'categoryTitle', 'sectionType', 'technical'],
  draft: ['question', 'category', 'categoryTitle', 'sectionType', 'technical'],
  published: [],
  withdrawn: [],
};

/** Actions that first ask in a dialog, because they cannot be undone cheaply (REQ-033). */
type ConfirmAction = 'withdraw' | 'reject';

const CONFIRM_TEXT: Record<ConfirmAction, string> = {
  withdraw: 'library.withdrawConfirm',
  reject: 'library.rejectConfirm',
};

/** The PATCH body of the edited fields, as the server stores them. */
function toPatch(
  fields: readonly EntryField[],
  values: EntryFormValues,
): UpdateLibraryEntryInput {
  const patch: UpdateLibraryEntryInput = {};
  for (const field of fields) {
    if (field === 'answerText') {
      patch.answerText = normalizeSpokenText(values.answerText) || null;
    } else if (field === 'language') {
      patch.language = values.language;
    } else if (field === 'sectionType') {
      patch.sectionType = values.sectionType;
    } else if (field === 'technical') {
      patch.technical = values.technical;
    } else {
      patch[field] = values[field].trim();
    }
  }
  return patch;
}

/** Everything the admin sees and does with one entry. Mounted per entry, keyed by its id. */
export function EntryPanelContent({ row }: { row: AdminLibraryEntry }) {
  const { t, i18n } = useTranslation('admin');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useLibraryEntry(row);
  const entry = detail.data;
  const update = useUpdateLibraryEntry();
  const changeStatus = useChangeLibraryEntryStatus();
  // Only the fields the admin touched. Untouched fields always show the server's value, and a
  // refetch after a 409 never throws away what the admin typed (section 8).
  const [edits, setEdits] = useState<Partial<EntryFormValues>>({});
  const [running, setRunning] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStatus = useRef(entry.status);

  // A status change swaps the action buttons, so the pressed one is gone. Focus moves to the
  // heading, which is read with the new status, instead of falling to the page body.
  useEffect(() => {
    if (shownStatus.current === entry.status) return;
    shownStatus.current = entry.status;
    headingRef.current?.focus();
  }, [entry.status]);

  const server = formValuesOf(entry);
  const values: EntryFormValues = { ...server, ...edits };
  const editable = EDITABLE[entry.status];
  const changed = editable.filter(
    (field) => field in edits && values[field] !== server[field],
  );
  const hasBlankField = editable.some((field) => isBlank(values, field));
  const spokenLength = normalizeSpokenText(values.answerText).length;

  function setField<K extends EntryField>(field: K, value: EntryFormValues[K]) {
    setEdits((current) => ({ ...current, [field]: value }));
  }

  /**
   * What the admin typed into `field` that the entry's status no longer lets them edit, when it
   * differs from the server's text. Null when there is nothing to keep.
   */
  function unsavedText(field: 'question' | 'answerText'): string | null {
    const typed = edits[field];
    if (typed === undefined || editable.includes(field)) return null;
    const normalizedTyped = normalizeSpokenText(typed);
    if (!normalizedTyped) return null;
    return normalizedTyped === normalizeSpokenText(server[field])
      ? null
      : typed;
  }

  function dismissUnsaved(field: 'question' | 'answerText') {
    setEdits((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  const unsavedQuestion = unsavedText('question');
  const unsavedAnswer = unsavedText('answerText');

  async function run(action: Exclude<Action, 'record'>) {
    // The status the screen shows now. A status change sends it, so a stale screen gets a 409.
    const fromStatus = entry.status;
    setErrorKey(null);
    setRunning(action);
    try {
      // Save the edits first, so what gets approved or published is what the admin sees.
      if (action !== 'withdraw' && changed.length > 0) {
        await update.mutateAsync({
          id: entry.id,
          input: toPatch(changed, values),
        });
        setEdits({});
      }
      if (action !== 'save') {
        await changeStatus.mutateAsync({
          id: entry.id,
          input: { status: ACTION_TARGET[action], fromStatus },
        });
      }
      toast.success(t(`library.toast.${action}`));
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        navigate('/forbidden', { replace: true });
        return;
      }
      setErrorKey(libraryErrorKey(error));
      // Another admin may have moved the entry: show its current state.
      void queryClient.invalidateQueries({ queryKey: libraryEntryKeys.all });
    } finally {
      setRunning(null);
    }
  }

  function isActionDisabled(action: Action): boolean {
    if (running !== null) return true;
    if (action === 'save') return changed.length === 0 || hasBlankField;
    if (action === 'markReady') {
      return hasBlankField || spokenLength === 0 || spokenLength > HARD_LIMIT;
    }
    if (action === 'publish') return hasBlankField;
    return false;
  }

  const actionVariant = (action: Action) =>
    action === 'markReady' || action === 'publish' || action === 'record'
      ? 'primary'
      : action === 'withdraw' || action === 'reject'
        ? 'danger-soft'
        : 'secondary';

  const hasVideoPanel =
    entry.status === 'draft' || entry.status === 'published';
  const isEditable = editable.length > 0;
  const actions = STATUS_ACTIONS[entry.status];

  return (
    <>
      <Drawer.Header className="flex flex-col items-start gap-2">
        <Drawer.Heading ref={headingRef} tabIndex={-1} className="outline-none">
          {t('library.panel.title', { key: entry.key })}
        </Drawer.Heading>
        {/* After a failed read the status shown would be stale, so it is left out. */}
        {detail.isError ? null : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Chip color={STATUS_COLOR[entry.status]} variant="soft" size="sm">
              {t(`library.status.${entry.status}`)}
            </Chip>
            <span>{t(`language.${entry.language}`, { ns: 'common' })}</span>
            {entry.durationMs !== null ? (
              <span>
                {t('library.duration', {
                  seconds: formatNumber(
                    Math.round(entry.durationMs / 1000),
                    i18n.language,
                  ),
                })}
              </span>
            ) : null}
          </div>
        )}
      </Drawer.Header>

      {detail.isError ? (
        // The entry could not be read again after a write: its old state would mislead, so the
        // panel shows only the error and a retry. What the admin typed stays in `edits`.
        <Drawer.Body>
          <InlineAlert
            status="danger"
            title={t('library.panel.loadError')}
            onRetry={() => void detail.refetch()}
          />
        </Drawer.Body>
      ) : (
        <>
          <Drawer.Body className="flex flex-col gap-5">
            {errorKey ? (
              <InlineAlert status="danger" title={t(errorKey)} />
            ) : null}

            {hasVideoPanel ? (
              entry.videoAssetId ? (
                <EntryVideo
                  key={entry.videoAssetId}
                  videoAssetId={entry.videoAssetId}
                  entryKey={entry.key}
                />
              ) : (
                <p className="text-sm text-muted">
                  {t('library.panel.noVideo')}
                </p>
              )
            ) : null}

            {entry.status === 'ready' ? (
              <InlineAlert status="info">{t('library.readyHint')}</InlineAlert>
            ) : null}
            {entry.status === 'published' ? (
              <InlineAlert status="info">
                {t('library.publishedNote')}
              </InlineAlert>
            ) : null}

            {entry.status === 'pending' && entry.answerOriginal ? (
              <ReadOnlyText
                label={t('library.fields.answerOriginal')}
                scrollable
              >
                {entry.answerOriginal}
              </ReadOnlyText>
            ) : null}

            {isEditable ? (
              <QuestionField values={values} onChange={setField} />
            ) : (
              <ReadOnlyText label={t('library.fields.question')}>
                {entry.question}
              </ReadOnlyText>
            )}
            {unsavedQuestion !== null ? (
              <UnsavedText
                fieldLabel={t('library.fields.question')}
                text={unsavedQuestion}
                onDismiss={() => dismissUnsaved('question')}
              />
            ) : null}

            {entry.status === 'pending' ? (
              <SpokenAnswerEditor values={values} onChange={setField} />
            ) : (
              <ReadOnlyText label={t('library.fields.answerText')}>
                {entry.answerText ?? t('library.panel.noSpokenText')}
              </ReadOnlyText>
            )}
            {unsavedAnswer !== null ? (
              <UnsavedText
                fieldLabel={t('library.fields.answerText')}
                text={unsavedAnswer}
                onDismiss={() => dismissUnsaved('answerText')}
              />
            ) : null}

            {isEditable ? (
              <LabelFields
                values={values}
                onChange={setField}
                withLanguage={entry.status === 'pending'}
              />
            ) : (
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {(
                  [
                    ['category', entry.category],
                    ['categoryTitle', entry.categoryTitle],
                    [
                      'sectionType',
                      t(`library.sectionType.${entry.sectionType}`),
                    ],
                    ['technical', t(`library.technical.${entry.technical}`)],
                  ] as const
                ).map(([field, value]) => (
                  <div key={field} className="flex flex-col gap-0.5">
                    <dt className="text-muted">
                      {t(`library.fields.${field}`)}
                    </dt>
                    <dd className="text-foreground">
                      <bdi>{value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Drawer.Body>

          {actions.length > 0 ? (
            <Drawer.Footer className="flex flex-wrap justify-end gap-2">
              {actions.map((action) => (
                <Button
                  key={action}
                  variant={actionVariant(action)}
                  className="min-h-11 md:min-h-9"
                  isPending={running === action}
                  isDisabled={isActionDisabled(action)}
                  onPress={() => {
                    if (action === 'record') {
                      const query = new URLSearchParams({ entry: entry.id, key: entry.key });
                      navigate(`/library/record?${query.toString()}`);
                    } else if (action === 'withdraw' || action === 'reject') {
                      setConfirming(action);
                    } else {
                      void run(action);
                    }
                  }}
                >
                  {t(`library.actions.${action}`)}
                </Button>
              ))}
            </Drawer.Footer>
          ) : null}
        </>
      )}

      <AlertDialog.Backdrop
        isOpen={confirming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirming(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            {confirming ? (
              <>
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger" />
                  <AlertDialog.Heading>
                    {t(`library.actions.${confirming}`)}
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>{t(CONFIRM_TEXT[confirming])}</p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button
                    variant="tertiary"
                    onPress={() => setConfirming(null)}
                  >
                    {t('library.actions.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    onPress={() => {
                      setConfirming(null);
                      void run(confirming);
                    }}
                  >
                    {t(`library.actions.${confirming}`)}
                  </Button>
                </AlertDialog.Footer>
              </>
            ) : null}
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

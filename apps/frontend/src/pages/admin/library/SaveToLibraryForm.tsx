import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Input, Label, TextField } from '@heroui/react';
import {
  useCreateLibraryEntry,
  type AdminLibraryEntry,
} from '@/entities/library-entry';
import { isApiError } from '@/shared/api';
import { Button, InlineAlert } from '@/shared/ui';
import { LabelFields, QuestionField } from './EntryFields';
import { isBlank, type EntryField, type EntryFormValues } from './entryForm';
import { libraryErrorKey } from './libraryText';

/** The answer text comes from the recording, so the form has no field for it. */
const EMPTY_VALUES: EntryFormValues = {
  question: '',
  answerText: '',
  language: 'fa',
  category: '',
  categoryTitle: '',
  sectionType: 'knowledge',
  technical: 'non-technical',
};

const REQUIRED: readonly EntryField[] = [
  'question',
  'category',
  'categoryTitle',
];

/**
 * Saves a finished recording as a new `draft` entry (REQ-034, REQ-004). The fields can be filled
 * while the recording is still processing; Save is enabled once `videoAssetId` is set, which the
 * caller does only for a `VIDEO_GENERATED` video. What the admin typed stays after a failure.
 */
export function SaveToLibraryForm({
  videoAssetId,
  onSaved,
}: {
  videoAssetId: string | null;
  onSaved: (entry: AdminLibraryEntry) => void;
}) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const create = useCreateLibraryEntry();
  const [values, setValues] = useState<EntryFormValues>(EMPTY_VALUES);
  const [key, setKey] = useState('');
  const [hasTriedSave, setHasTriedSave] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function setField<K extends EntryField>(field: K, value: EntryFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasTriedSave(true);
    if (!videoAssetId || REQUIRED.some((field) => isBlank(values, field)))
      return;
    setErrorKey(null);
    try {
      const entry = await create.mutateAsync({
        videoAssetId,
        question: values.question.trim(),
        language: values.language,
        category: values.category.trim(),
        categoryTitle: values.categoryTitle.trim(),
        sectionType: values.sectionType,
        technical: values.technical,
        // Without a key the server names the entry after the recording (REQ-004).
        ...(key.trim() ? { key: key.trim() } : {}),
      });
      onSaved(entry);
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        navigate('/forbidden', { replace: true });
        return;
      }
      setErrorKey(libraryErrorKey(error));
    }
  }

  return (
    <form
      aria-label={t('library.record.save')}
      className="flex flex-col gap-4"
      onSubmit={(event) => void save(event)}
      noValidate
    >
      {errorKey ? <InlineAlert status="danger" title={t(errorKey)} /> : null}
      <QuestionField
        values={values}
        onChange={setField}
        showErrors={hasTriedSave}
      />
      <TextField value={key} onChange={setKey} fullWidth>
        <Label>{t('library.columns.key')}</Label>
        <Input dir="ltr" maxLength={80} className="min-h-11 md:min-h-9" />
      </TextField>
      <LabelFields
        values={values}
        onChange={setField}
        showErrors={hasTriedSave}
        withLanguage
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          className="min-h-11 md:min-h-9"
          isDisabled={videoAssetId === null}
          isPending={create.isPending}
        >
          {t('library.record.save')}
        </Button>
      </div>
    </form>
  );
}

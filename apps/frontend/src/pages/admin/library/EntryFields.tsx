import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError, Input, Label, TextArea, TextField } from '@heroui/react';
import { formatNumber } from '@/i18n';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { isBlank, type EntryField, type EntryFormValues } from './entryForm';
import { LibrarySelect } from './LibrarySelect';
import {
  HARD_LIMIT,
  LANGUAGES,
  normalizeSpokenText,
  RULE_KEYS,
  SECTION_TYPES,
  SOFT_LIMIT,
  TECHNICAL_VALUES,
} from './libraryText';

interface FieldProps {
  values: EntryFormValues;
  onChange: <K extends EntryField>(field: K, value: EntryFormValues[K]) => void;
  /**
   * Whether a blank required field shows its error. False on an empty new form until the admin
   * first tries to save, so the form does not open covered in errors.
   */
  showErrors?: boolean;
}

function TextInputField({
  field,
  label,
  maxLength,
  values,
  onChange,
  showErrors = true,
  multiline = false,
}: FieldProps & {
  field: 'question' | 'category' | 'categoryTitle';
  label: string;
  maxLength: number;
  multiline?: boolean;
}) {
  const { t } = useTranslation('admin');
  const isInvalid = showErrors && isBlank(values, field);

  return (
    <TextField
      isRequired
      isInvalid={isInvalid}
      validationBehavior="aria"
      value={values[field]}
      onChange={(value) => onChange(field, value)}
      fullWidth
    >
      <Label>{label}</Label>
      {multiline ? (
        <TextArea rows={2} maxLength={maxLength} dir="auto" />
      ) : (
        <Input
          maxLength={maxLength}
          dir="auto"
          className="min-h-11 md:min-h-9"
        />
      )}
      {isInvalid ? (
        <FieldError>{t('library.errors.required')}</FieldError>
      ) : null}
    </TextField>
  );
}

export function QuestionField(props: FieldProps) {
  const { t } = useTranslation('admin');
  return (
    <TextInputField
      {...props}
      field="question"
      label={t('library.fields.question')}
      maxLength={300}
      multiline
    />
  );
}

/** Category, category title, section type and technical; the language only in `pending`. */
export function LabelFields({
  values,
  onChange,
  showErrors,
  withLanguage,
}: FieldProps & { withLanguage: boolean }) {
  const { t } = useTranslation('admin');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withLanguage ? (
        <LibrarySelect
          label={t('library.fields.language')}
          value={values.language}
          options={LANGUAGES.map((id) => ({
            id,
            label: t(`language.${id}`, { ns: 'common' }),
          }))}
          onChange={(value) => {
            if (value) onChange('language', value);
          }}
        />
      ) : null}
      <TextInputField
        values={values}
        onChange={onChange}
        showErrors={showErrors}
        field="category"
        label={t('library.fields.category')}
        maxLength={100}
      />
      <TextInputField
        values={values}
        onChange={onChange}
        showErrors={showErrors}
        field="categoryTitle"
        label={t('library.fields.categoryTitle')}
        maxLength={200}
      />
      <LibrarySelect
        label={t('library.fields.sectionType')}
        value={values.sectionType}
        options={SECTION_TYPES.map((id) => ({
          id,
          label: t(`library.sectionType.${id}`),
        }))}
        onChange={(value) => {
          if (value) onChange('sectionType', value);
        }}
      />
      <LibrarySelect
        label={t('library.fields.technical')}
        value={values.technical}
        options={TECHNICAL_VALUES.map((id) => ({
          id,
          label: t(`library.technical.${id}`),
        }))}
        onChange={(value) => {
          if (value) onChange('technical', value);
        }}
      />
    </div>
  );
}

/** A labelled text the admin reads but does not edit. */
export function ReadOnlyText({
  label,
  children,
  scrollable = false,
}: {
  label: string;
  children: string;
  /** The original answer is up to 5000 characters, so it scrolls in its own region. */
  scrollable?: boolean;
}) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1">
      <p id={labelId} className="text-sm font-medium text-muted">
        {label}
      </p>
      {/* `auto`: Persian content reads right to left inside the English screen too. */}
      <p
        dir="auto"
        {...(scrollable
          ? { role: 'region', 'aria-labelledby': labelId, tabIndex: 0 }
          : {})}
        className={cn(
          'rounded-lg bg-surface-secondary p-3 text-sm whitespace-pre-wrap text-foreground',
          scrollable && 'max-h-48 overflow-y-auto',
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * Text the admin typed that the entry no longer lets them edit, because another admin moved it on
 * meanwhile (a 409). It stays readable and selectable next to the server's text, so nothing typed
 * is lost (section 8), until the admin dismisses it or closes the panel.
 */
export function UnsavedText({
  fieldLabel,
  text,
  onDismiss,
}: {
  fieldLabel: string;
  text: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('admin');

  return (
    <section
      aria-label={`${t('library.unsavedText')} (${fieldLabel})`}
      className="flex flex-col gap-2 rounded-lg border border-warning p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-warning">
          {t('library.unsavedText')}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 md:min-h-8"
          onPress={onDismiss}
        >
          {t('library.actions.dismiss')}
        </Button>
      </div>
      <p
        dir="auto"
        className="text-sm whitespace-pre-wrap text-foreground select-text"
      >
        {text}
      </p>
    </section>
  );
}

/**
 * The spoken answer of a `pending` entry, with the rewrite rules beside it on a wide screen and
 * above it on a phone (REQ-073). The counter counts the text as the server stores it.
 */
export function SpokenAnswerEditor({ values, onChange }: FieldProps) {
  const { t, i18n } = useTranslation('admin');
  const rulesId = useId();
  const rulesHeadingId = useId();
  const counterId = useId();
  const length = normalizeSpokenText(values.answerText).length;
  const isOverSoft = length > SOFT_LIMIT;
  const isOverHard = length > HARD_LIMIT;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section
        id={rulesId}
        aria-labelledby={rulesHeadingId}
        className="rounded-lg bg-surface-secondary p-4 text-sm text-foreground lg:order-last"
      >
        <h3 id={rulesHeadingId} className="mb-2 font-semibold">
          {t('library.rules.title')}
        </h3>
        <ol className="flex list-decimal flex-col gap-1 ps-5">
          {RULE_KEYS.map((rule) => (
            <li key={rule}>{t(`library.rules.${rule}`)}</li>
          ))}
        </ol>
      </section>

      <TextField
        isInvalid={isOverHard}
        validationBehavior="aria"
        value={values.answerText}
        onChange={(value) => onChange('answerText', value)}
        fullWidth
      >
        <Label>{t('library.fields.answerText')}</Label>
        <TextArea
          rows={7}
          dir="auto"
          aria-describedby={`${rulesId} ${counterId}`}
        />
        {/*
          Plain elements, not HeroUI's Description: TextField hides its description while the
          field is invalid, and the counter must stay in view above 480 characters too. The count
          and the limit it is measured against are two elements (the counter key holds the count only).
          Digits follow the language, as the durations do (section 10).
        */}
        <p
          id={counterId}
          aria-live="polite"
          className={cn(
            'flex gap-1 text-xs',
            isOverHard
              ? 'text-danger'
              : isOverSoft
                ? 'text-warning'
                : 'text-muted',
          )}
        >
          <span>
            {t('library.rules.counter', {
              count: formatNumber(length, i18n.language),
            })}
          </span>
          <span aria-hidden="true">/</span>
          <span>
            {formatNumber(isOverSoft ? HARD_LIMIT : SOFT_LIMIT, i18n.language)}
          </span>
        </p>
        {isOverHard ? (
          <FieldError>{t('library.rules.overHard')}</FieldError>
        ) : isOverSoft ? (
          <p className="text-sm text-warning">{t('library.rules.overSoft')}</p>
        ) : null}
      </TextField>
    </div>
  );
}

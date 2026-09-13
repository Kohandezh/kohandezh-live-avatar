import {
  DateField,
  Description,
  FieldError,
  I18nProvider,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import { Controller, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  birthDateLocale,
  earliestBirthDate,
  isoToPersianDate,
  latestBirthDate,
  persianDateToIso,
} from './jalali';
import type { ProfileValues } from './schemas';

interface NameFieldProps {
  control: Control<ProfileValues>;
  name: 'firstName' | 'lastName';
  label: string;
  autoComplete: 'given-name' | 'family-name';
  isDisabled?: boolean;
}

/**
 * One name input. `Controller` owns the value so HeroUI's `TextField` stays a
 * controlled React Aria field; `field.ref` still points at the real input, so
 * `setFocus()` and the browser's own "jump to the invalid field" both work.
 */
function NameField({
  control,
  name,
  label,
  autoComplete,
  isDisabled,
}: NameFieldProps) {
  const { t } = useTranslation();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          isInvalid={Boolean(fieldState.error)}
          validationBehavior="aria"
          isDisabled={isDisabled}
          value={field.value}
          onChange={field.onChange}
          fullWidth
        >
          <Label>{label}</Label>
          <Input
            ref={field.ref}
            name={field.name}
            onBlur={field.onBlur}
            autoComplete={autoComplete}
            className="min-h-11"
          />
          {fieldState.error?.message ? (
            <FieldError>{t(fieldState.error.message)}</FieldError>
          ) : null}
        </TextField>
      )}
    />
  );
}

/**
 * The birthday, typed in the Jalali (Solar Hijri) calendar.
 *
 * A segmented `DateField` rather than a calendar popover: a birthday is 20 to 80 years back, and
 * paging a month grid that far is slow on a phone. Typing three numbers is not. React Aria still
 * gives each segment its own arrow-key stepping, its own accessible name, and a real spinbutton
 * role, so keyboard and screen-reader users are not worse off than with a grid.
 *
 * The form value stays the Gregorian ISO string the API stores. Only this component ever holds
 * a Persian-calendar object, which keeps the conversion in one place.
 *
 * `I18nProvider` is nested inside the app's own one on purpose. It forces the Persian calendar
 * for this field alone (see `birthDateLocale`), so the birthday stays Jalali even when the
 * interface is in English. It renders no DOM, so the layout is unchanged.
 */
function BirthDateField({
  control,
  isDisabled,
}: {
  control: Control<ProfileValues>;
  isDisabled?: boolean;
}) {
  // `i18n.language`, not the Redux language: this needs the language i18next actually resolved,
  // and it keeps `features/profile` from depending on `features/settings`.
  const { t, i18n } = useTranslation();

  return (
    <Controller
      control={control}
      name="birthDate"
      render={({ field, fieldState }) => (
        <I18nProvider locale={birthDateLocale(i18n.language)}>
          <DateField
            isInvalid={Boolean(fieldState.error)}
            validationBehavior="aria"
            isDisabled={isDisabled}
            value={isoToPersianDate(field.value)}
            onChange={(value) => field.onChange(persianDateToIso(value))}
            minValue={earliestBirthDate()}
            maxValue={latestBirthDate()}
            granularity="day"
            fullWidth
          >
            <Label>{t('settings.personal.birthDate')}</Label>
            <DateField.Group className="min-h-11">
              <DateField.Input>
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
            </DateField.Group>
            {fieldState.error?.message ? (
              <FieldError>{t(fieldState.error.message)}</FieldError>
            ) : (
              <Description>
                {t('settings.personal.birthDateHint')}
              </Description>
            )}
          </DateField>
        </I18nProvider>
      )}
    />
  );
}

export interface ProfileFieldsProps {
  control: Control<ProfileValues>;
  isDisabled?: boolean;
}

/**
 * The editable profile: first name, last name, birthday. Shared by onboarding step 1 and the
 * personal information screen so the two cannot drift apart.
 *
 * Sharing is not only tidiness here. `PUT /api/me/profile` is a full replace, so a screen that
 * left the birthday out would clear it on every save.
 *
 * The name inputs are deliberately not `dir="ltr"`: a Persian name is Persian text. Errors live
 * in `FieldError`, so React Aria links them to the input with `aria-describedby`.
 */
export function ProfileFields({ control, isDisabled }: ProfileFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <NameField
        control={control}
        name="firstName"
        label={t('settings.personal.firstName')}
        autoComplete="given-name"
        isDisabled={isDisabled}
      />
      <NameField
        control={control}
        name="lastName"
        label={t('settings.personal.lastName')}
        autoComplete="family-name"
        isDisabled={isDisabled}
      />
      <BirthDateField control={control} isDisabled={isDisabled} />
    </div>
  );
}

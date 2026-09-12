import { FieldError, Input, Label, TextField } from '@heroui/react';
import { Controller, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { ProfileNameValues } from './schemas';

interface NameFieldProps {
  control: Control<ProfileNameValues>;
  name: keyof ProfileNameValues;
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

export interface ProfileNameFieldsProps {
  control: Control<ProfileNameValues>;
  isDisabled?: boolean;
}

/**
 * First and last name, the only editable profile data. Shared by onboarding
 * step 1 and the personal information screen so the two cannot drift apart.
 *
 * The inputs are deliberately not `dir="ltr"`: a Persian name is Persian text.
 * Errors live in `FieldError`, so React Aria links them to the input with
 * `aria-describedby`.
 */
export function ProfileNameFields({
  control,
  isDisabled,
}: ProfileNameFieldsProps) {
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
    </div>
  );
}

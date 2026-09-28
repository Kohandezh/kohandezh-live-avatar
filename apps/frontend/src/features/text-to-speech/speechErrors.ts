import { isApiError } from '@/shared/api';

/**
 * The `admin` i18n key for a failed speech call, from TTS or from speak (section 8, "Admin
 * recording flow"). An unpaid plan and a busy or used-up quota have their own messages; every
 * other failure says the avatar could not speak.
 */
export function speechErrorKey(error: unknown): string {
  const code = isApiError(error) ? error.serverCode : undefined;
  if (code === 'elevenlabs_payment')
    return 'library.record.errors.speechPayment';
  if (code === 'elevenlabs_quota') return 'library.record.errors.speechBusy';
  return 'library.record.errors.speechFailed';
}

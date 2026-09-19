import { z } from 'zod';
import { userSchema } from '@/entities/user';
import { apiClient } from '@/shared/api';

/**
 * POST /api/auth/otp/request
 * The backend normalizes the phone to E.164 and sends (or logs, in
 * development) a one-time code. `devCode` comes back only when the backend is in development
 * and prints the code to its console instead of sending an SMS. Once a real SMS goes out the
 * field is absent, so the screen never shows a code the user can already read.
 */
export const otpRequestResponseSchema = z.object({
  phone: z.string(),
  expiresInSeconds: z.number(),
  resendAfterSeconds: z.number(),
  devCode: z.string().optional(),
});

export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export async function requestOtp(input: {
  phone: string;
}): Promise<OtpRequestResponse> {
  const { data } = await apiClient.post('/api/auth/otp/request', input);
  return otpRequestResponseSchema.parse(data);
}

/**
 * POST /api/auth/otp/verify
 * Web: the backend sets an HttpOnly session cookie and may omit accessToken.
 * Native: the backend returns accessToken, which we keep in secure storage.
 */
export const loginResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string().optional(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export async function verifyOtp(input: {
  phone: string;
  code: string;
}): Promise<LoginResponse> {
  const { data } = await apiClient.post('/api/auth/otp/verify', input);
  return loginResponseSchema.parse(data);
}

/** POST /api/auth/logout. Clears the cookie session on the server. */
export async function logout(): Promise<void> {
  await apiClient.post('/api/auth/logout');
}

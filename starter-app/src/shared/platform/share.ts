import { isNative } from './isNative';

export async function shareText(opts: { title?: string; text: string; url?: string }): Promise<boolean> {
  if (isNative()) {
    const { Share } = await import('@capacitor/share');
    await Share.share(opts);
    return true;
  }
  if (navigator.share) {
    await navigator.share(opts);
    return true;
  }
  await navigator.clipboard?.writeText([opts.text, opts.url].filter(Boolean).join('\n'));
  return false; // copied instead of shared — caller may inform the user
}

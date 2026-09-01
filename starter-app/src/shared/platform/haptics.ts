import { isNative } from './isNative';

export async function hapticTap(): Promise<void> {
  if (isNative()) {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } else if ('vibrate' in navigator) {
    navigator.vibrate?.(10);
  }
}

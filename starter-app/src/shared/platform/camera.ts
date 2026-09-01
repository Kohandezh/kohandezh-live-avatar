import { isNative } from './isNative';

// Feature → Platform Abstraction → (Web impl | Native impl). Features import THIS, never plugins.
export interface CapturedPhoto {
  /** data: URL or object URL usable in <img src>. */
  uri: string;
  mimeType: string;
}

export async function takePhoto(): Promise<CapturedPhoto | null> {
  if (isNative()) {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
    });
    if (!photo.webPath) return null;
    return { uri: photo.webPath, mimeType: `image/${photo.format}` };
  }
  // Web fallback: <input type="file" capture>. Same contract, different mechanism.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? { uri: URL.createObjectURL(file), mimeType: file.type } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Wraps raw PCM S16LE samples in a RIFF/WAVE header so a standard `<audio>` element can play it.
 * The orchestrator serves `audio/L16;rate=24000;channels=1` which browsers cannot play natively.
 */
export function pcm16ToWav(pcm: ArrayBuffer, sampleRate = 24_000, channels = 1): Blob {
  const bytesPerSample = 2;
  const dataLength = pcm.byteLength - (pcm.byteLength % (bytesPerSample * channels));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);
  return new Blob([header, pcm.slice(0, dataLength)], { type: 'audio/wav' });
}

export function pcm16DurationMs(byteLength: number, sampleRate = 24_000, channels = 1): number {
  return Math.round((byteLength / (2 * channels) / sampleRate) * 1000);
}

import { pcm16DurationMs, pcm16ToWav } from './wav';

describe('pcm16ToWav', () => {
  it('writes a valid 44-byte RIFF header', async () => {
    const pcm = new Int16Array(2400).buffer; // 100 ms at 24 kHz
    const blob = pcm16ToWav(pcm, 24000, 1);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 4800);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob.slice(0, 44));
    });
    const header = new DataView(bytes);
    expect(
      String.fromCharCode(
        header.getUint8(0),
        header.getUint8(1),
        header.getUint8(2),
        header.getUint8(3),
      ),
    ).toBe('RIFF');
    expect(header.getUint32(24, true)).toBe(24000);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(40, true)).toBe(4800);
  });
  it('computes duration from byte length', () => {
    expect(pcm16DurationMs(48000)).toBe(1000);
  });
});

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** How often to look for the avatar's audio track. The track arrives after the element. */
const ATTACH_POLL_MS = 500;

/**
 * Turns an RMS reading into something the eye can use. Normal speech sits around 0.05 to
 * 0.2 RMS, so without a gain the sphere would barely move.
 */
const LEVEL_GAIN = 3.5;

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const scoped = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? scoped.webkitAudioContext ?? null;
}

/** The avatar's audio arrives as a MediaStream on the element, never as a `src` URL. */
function readStream(element: HTMLMediaElement | null): MediaStream | null {
  if (!element) return null;
  if (typeof MediaStream === 'undefined') return null;
  const source = element.srcObject;
  if (!(source instanceof MediaStream)) return null;
  return source.getAudioTracks().length > 0 ? source : null;
}

/**
 * Measures how loud the avatar is, from the page's own media element.
 *
 * Returns a `readLevel()` the animation loop calls once per frame. It answers a number
 * between 0 and 1, or **null** when no measurement is possible: no track yet, no
 * AudioContext, or a context the browser refuses to run. Null is not an error. The caller
 * falls back to a synthetic envelope, and the user sees no difference.
 *
 * Two rules that are easy to get wrong:
 *
 * 1. `createMediaStreamSource`, never `createMediaElementSource`. The element version
 *    *reroutes* the element's output into the graph, that reroute can never be undone for
 *    that element, and forgetting to connect the graph to `destination` makes the avatar
 *    go silent.
 * 2. This graph is never connected to `destination`. It listens, it does not play. The
 *    element itself is still what the user hears.
 *
 * livekit-client's `createAudioAnalyser` is not used: it wants the private LiveKit track
 * object, builds its own AudioContext on every call, and reads frequency data with
 * `maxDecibels: -80`, which clips loud speech to 1.0 all the time.
 */
export function useAvatarAudioLevel(
  mediaRef: RefObject<HTMLMediaElement | null>,
  isActive: boolean,
): () => number | null {
  const analyserRef = useRef<AnalyserNode | null>(null);
  // `Uint8Array<ArrayBuffer>` and not a plain `Uint8Array`: the DOM types refuse a buffer
  // that might be shared, and a plain `Uint8Array` could be backed by a `SharedArrayBuffer`.
  const samplesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isActive) return;

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) return;

    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let attachedStream: MediaStream | null = null;
    let cancelled = false;

    const detach = () => {
      source?.disconnect();
      source = null;
      attachedStream = null;
      analyserRef.current = null;
      samplesRef.current = null;
    };

    const attach = () => {
      const stream = readStream(mediaRef.current);
      if (cancelled || stream === attachedStream) return;

      detach();
      if (!stream) return;

      try {
        context ??= new AudioContextClass();
        contextRef.current = context;
        // A context created without a user gesture starts suspended. Asking it to run is
        // worth a try; if the browser says no, `readLevel` reports null and the caller
        // uses the synthetic envelope instead.
        if (context.state === 'suspended') void context.resume();

        const analyser = context.createAnalyser();
        // 1024 samples is about 21 ms at 48 kHz: long enough to be steady, short enough
        // to follow a syllable.
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        source = context.createMediaStreamSource(stream);
        source.connect(analyser);

        analyserRef.current = analyser;
        samplesRef.current = new Uint8Array(analyser.fftSize);
        attachedStream = stream;
      } catch {
        // A browser that refuses the graph is a missing measurement, not a broken screen.
        detach();
      }
    };

    attach();
    // The track can arrive well after the element does, and it can be replaced during the
    // call, so keep checking. One comparison every half second costs nothing.
    const timer = window.setInterval(attach, ATTACH_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      detach();
      void context?.close().catch(() => undefined);
      context = null;
      contextRef.current = null;
    };
  }, [isActive, mediaRef]);

  return useCallback(() => {
    const analyser = analyserRef.current;
    const samples = samplesRef.current;
    const context = contextRef.current;
    if (!analyser || !samples || context?.state !== 'running') return null;

    analyser.getByteTimeDomainData(samples);

    // Root mean square of the waveform around its silent midpoint (128).
    let sum = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / samples.length);

    const level = rms * LEVEL_GAIN;
    return level > 1 ? 1 : level;
  }, []);
}

import { useAppSelector } from '@/app/store';
import {
  AvatarSessionPanel,
  selectActiveSessionId,
  selectSessionTransport,
} from '@/features/avatar-session';
import { DiagnosticsPanel } from '@/features/diagnostics';
import { RecordingControls, selectRecordingActive } from '@/features/recording';
import { TtsComposer, selectComposerText, selectLastAudioAssetId } from '@/features/text-to-speech';

// The development workbench: composer + audio, avatar session, recording, diagnostics.
// The page passes shared client state between features so they stay independent of each other.
export function AvatarSessionPage() {
  const text = useAppSelector(selectComposerText);
  const lastAudioAssetId = useAppSelector(selectLastAudioAssetId);
  const sessionId = useAppSelector(selectActiveSessionId);
  const recordingActive = useAppSelector(selectRecordingActive);
  const transport = useAppSelector(selectSessionTransport);

  return (
    // Requirement 13 added an app-wide dark mode. This page and its
    // features (avatar-session, recording, text-to-speech, diagnostics)
    // predate that and were never checked against it, so it is pinned to
    // light here rather than risk it looking broken in dark. `data-theme`
    // wins over the inherited `.dark` on `<html>` for every semantic color
    // token used below, because HeroUI keys its light values off
    // `[data-theme="light"]` directly on this element, not only on `:root`.
    <div
      data-theme="light"
      style={{ colorScheme: 'light' }}
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
    >
      <div className="flex flex-col gap-4">
        <TtsComposer />
        <RecordingControls
          sessionId={sessionId}
          text={text}
          audioAssetId={lastAudioAssetId}
          transport={transport}
        />
      </div>
      <AvatarSessionPanel text={text} recordingActive={recordingActive} />
      <div className="lg:col-span-2">
        <DiagnosticsPanel />
      </div>
    </div>
  );
}

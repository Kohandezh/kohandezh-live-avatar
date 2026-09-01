import { useAppSelector } from '@app/store';
import { AvatarSessionPanel, selectActiveSessionId } from '@features/avatar-session';
import { DiagnosticsPanel } from '@features/diagnostics';
import { RecordingControls, selectRecordingActive } from '@features/recording';
import { TtsComposer, selectComposerText, selectLastAudioAssetId } from '@features/text-to-speech';

// The development workbench: composer + audio, avatar session, recording, diagnostics.
// The page passes shared client state between features so they stay independent of each other.
export function AvatarSessionPage() {
  const text = useAppSelector(selectComposerText);
  const lastAudioAssetId = useAppSelector(selectLastAudioAssetId);
  const sessionId = useAppSelector(selectActiveSessionId);
  const recordingActive = useAppSelector(selectRecordingActive);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-4">
        <TtsComposer />
        <RecordingControls sessionId={sessionId} text={text} audioAssetId={lastAudioAssetId} />
      </div>
      <AvatarSessionPanel text={text} recordingActive={recordingActive} />
      <div className="lg:col-span-2">
        <DiagnosticsPanel />
      </div>
    </div>
  );
}

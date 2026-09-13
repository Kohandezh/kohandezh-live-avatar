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
    // This page used to pin itself to light with data-theme="light", because it predates the
    // app-wide dark mode and had never been checked against it. That pin made four white cards
    // and a white textarea sit on a near-black page whenever the user picked dark. The pin is
    // gone and the four features below now use semantic tokens, so the page follows the theme.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
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

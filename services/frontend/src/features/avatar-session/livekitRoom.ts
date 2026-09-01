import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type DisconnectReason,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { RoomCallbacks } from './types';

// One LiveKit Room per tab. The Room object is not serializable and therefore lives here rather
// than in Redux; the feature hook drives it and mirrors its state into the session slice.
//
// The browser joins with the subscribe-only token minted by the orchestrator. It never publishes
// and never mints tokens itself.

export interface MediaTargets {
  video?: HTMLVideoElement | null;
  audioHost?: HTMLElement | null;
}

let room: Room | null = null;
let callbacks: RoomCallbacks | null = null;
let targets: MediaTargets = {};
const attachedAudio = new Map<RemoteTrack, HTMLMediaElement>();

function trackKind(track: RemoteTrack): 'audio' | 'video' | null {
  if (track.kind === Track.Kind.Video) return 'video';
  if (track.kind === Track.Kind.Audio) return 'audio';
  return null;
}

function attachTrack(track: RemoteTrack): void {
  const kind = trackKind(track);
  if (kind === 'video') {
    if (!targets.video) return;
    track.attach(targets.video);
    callbacks?.onTrack('video', true, { sid: track.sid });
  } else if (kind === 'audio') {
    if (attachedAudio.has(track)) return;
    const element = track.attach();
    attachedAudio.set(track, element);
    targets.audioHost?.append(element);
    callbacks?.onTrack('audio', true, { sid: track.sid });
  }
}

function detachTrack(track: RemoteTrack): void {
  const kind = trackKind(track);
  track.detach();
  attachedAudio.get(track)?.remove();
  attachedAudio.delete(track);
  if (kind) callbacks?.onTrack(kind, false, { sid: track.sid });
}

function attachAllSubscribed(): void {
  if (!room) return;
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) attachTrack(publication.track);
    }
  }
}

/** Called by the video component so tracks that arrive before/after mount both get attached. */
export function setMediaTargets(next: MediaTargets): void {
  targets = next;
  attachAllSubscribed();
}

export function isRoomConnected(): boolean {
  return room?.state === ConnectionState.Connected;
}

export async function connectRoom(url: string, token: string, cb: RoomCallbacks): Promise<void> {
  if (room) await disconnectRoom();
  callbacks = cb;
  const next = new Room({ adaptiveStream: true, dynacast: true });
  room = next;

  next
    .on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        cb.onEvent('info', 'LiveKit track subscribed', {
          kind: track.kind,
          source: pub.source,
          participant: participant.identity,
        });
        attachTrack(track);
      },
    )
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      cb.onEvent('info', 'LiveKit track unsubscribed', { kind: track.kind });
      detachTrack(track);
    })
    .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      cb.onEvent('info', 'LiveKit participant connected', { participant: participant.identity });
    })
    .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      cb.onEvent('warn', 'LiveKit participant disconnected', { participant: participant.identity });
    })
    .on(RoomEvent.Reconnecting, () => cb.onConnection({ type: 'reconnecting' }))
    .on(RoomEvent.Reconnected, () => cb.onConnection({ type: 'reconnected' }))
    .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      cb.onConnection({
        type: 'disconnected',
        reason: reason === undefined ? undefined : String(reason),
      });
    })
    .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      cb.onEvent('info', 'LiveKit connection quality', {
        quality,
        participant: participant.identity,
      });
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, (playing: boolean) => cb.onAudioPlayback(playing))
    .on(RoomEvent.MediaDevicesError, (error: Error) =>
      cb.onEvent('error', 'Media device error', error),
    );

  await next.connect(url, token, { autoSubscribe: true });
  cb.onConnection({ type: 'connected' });
  cb.onAudioPlayback(next.canPlaybackAudio);
  attachAllSubscribed();
}

/** Resume audio after the browser's autoplay policy blocked it (requires a user gesture). */
export async function startRoomAudio(): Promise<void> {
  if (!room) return;
  await room.startAudio();
}

export async function disconnectRoom(): Promise<void> {
  const current = room;
  room = null;
  callbacks = null;
  for (const [track, element] of attachedAudio) {
    track.detach();
    element.remove();
  }
  attachedAudio.clear();
  if (current) {
    current.removeAllListeners();
    await current.disconnect();
  }
}

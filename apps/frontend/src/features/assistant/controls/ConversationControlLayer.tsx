import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ControlButton } from './ControlButton';
import {
  KeyboardIcon,
  MicIcon,
  PhoneEndIcon,
  StopIcon,
} from './ControlIcons';

/**
 * Why a control is refused, as i18n keys.
 *
 * Three messages cover the five refusals in the design: three of them are the same "wait for
 * the connection" sentence, so they share one string rather than three copies of it.
 */
export const CONTROL_REASONS = {
  notConnected: 'assistant.controls.reasons.notConnected',
  avatarNotSpeaking: 'assistant.controls.reasons.avatarNotSpeaking',
  offline: 'assistant.controls.reasons.offline',
} as const;

export interface ConversationControlLayerProps {
  /** True while `status === 'ending'`. End keeps its place and shows a spinner. */
  isEndPending: boolean;
  isMicMuted: boolean;
  /** The i18n key of the reason, or null when the control is pressable. */
  micReason: string | null;
  interruptReason: string | null;
  typeReason: string | null;
  onEnd: () => void;
  onToggleMic: () => void;
  onInterrupt: () => void;
  onType: () => void;
  /** Called with a reason key when a refused control is pressed. */
  onBlocked: (reasonKey: string) => void;
}

/**
 * The four physically anchored controls of the `/audio` conversation.
 *
 * End at the physical top left, type at the physical top right, interrupt at the physical
 * bottom left, the microphone at the physical bottom right. They do not mirror: the product
 * owner asked for controls that "stay in their own place", the way the buttons on a phone
 * call screen are learned by position and not by reading order. See
 * docs/DECISIONS/0013-physical-anchoring-for-conversation-controls.md and the
 * `control-anchor-*` comment block in globals.css.
 *
 * The layer covers the whole screen and is `pointer-events-none`, so a tap between the
 * controls reaches the orb behind it. Each control turns pointer events back on for itself.
 * The layer is capped at the content column's width and centred with it, so on a wide window
 * the controls frame the column instead of stranding it in the middle of an empty desktop.
 *
 * Its lifetime is the session's lifetime. It mounts at `requesting` and unmounts at `ended`,
 * and in between not one of the four ever appears or disappears. That is the whole point: the
 * old screen rearranged itself at the exact moment the connection succeeded, which is when
 * the user is watching it hardest.
 *
 * DOM order is the one thing that does mirror. The pixels are fixed, so one DOM order cannot
 * match reading order in both languages; the rows are reversed in Persian so that tab order
 * and a screen reader still run top-start to bottom-end. Nothing moves on screen.
 */
export const ConversationControlLayer = memo(function ConversationControlLayer({
  isEndPending,
  isMicMuted,
  micReason,
  interruptReason,
  typeReason,
  onEnd,
  onToggleMic,
  onInterrupt,
  onType,
  onBlocked,
}: ConversationControlLayerProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === 'rtl';

  // Every `control-anchor-*` name below is written out in full. Never compose one from parts:
  // Tailwind scans for literal strings, and a template would prune all four utilities and
  // drop every control into the same corner with no error anywhere.
  const topRow = [
    <ControlButton
      key="end"
      anchorClassName="control-anchor-top-left"
      // The visible word is the accessible name, so there is no second announcement and
      // voice control ("tap End", "tap پایان") reaches it. It is the only text in the layer,
      // which is what people aim at, so it is part of the button rather than beside it.
      label={t('assistant.end')}
      showLabel
      tone="danger"
      icon={<PhoneEndIcon className="size-5" />}
      isPending={isEndPending}
      onPress={onEnd}
    />,
    <ControlButton
      key="type"
      anchorClassName="control-anchor-top-right"
      label={t('conversation.compose.open')}
      icon={<KeyboardIcon className="size-5" />}
      isBlocked={typeReason !== null}
      blockedReason={typeReason ? t(typeReason) : undefined}
      onPress={onType}
      onBlockedPress={() => onBlocked(typeReason ?? CONTROL_REASONS.notConnected)}
    />,
  ];

  const bottomRow = [
    <ControlButton
      key="interrupt"
      anchorClassName="control-anchor-bottom-left"
      label={t('assistant.interrupt')}
      icon={<StopIcon className="size-5" />}
      isBlocked={interruptReason !== null}
      blockedReason={interruptReason ? t(interruptReason) : undefined}
      onPress={onInterrupt}
      onBlockedPress={() =>
        onBlocked(interruptReason ?? CONTROL_REASONS.notConnected)
      }
    />,
    <ControlButton
      key="mic"
      anchorClassName="control-anchor-bottom-right"
      // The name says what the press will do. No `aria-pressed` with it: "unmute, pressed"
      // is double speak, and the slash plus the fill already carry the state.
      label={t(isMicMuted ? 'assistant.mic.unmute' : 'assistant.mic.mute')}
      icon={<MicIcon muted={isMicMuted} className="size-6" />}
      size="lg"
      // Solid only when it is genuinely live. A filled circle with a dimmed icon would read
      // as on and off at the same time.
      isFilled={!isMicMuted && micReason === null}
      isBlocked={micReason !== null}
      blockedReason={micReason ? t(micReason) : undefined}
      onPress={onToggleMic}
      onBlockedPress={() => onBlocked(micReason ?? CONTROL_REASONS.notConnected)}
    />,
  ];

  return (
    <div className="pointer-events-none absolute inset-0 mx-auto max-w-md">
      {isRtl ? [...topRow].reverse() : topRow}
      {isRtl ? [...bottomRow].reverse() : bottomRow}
    </div>
  );
});

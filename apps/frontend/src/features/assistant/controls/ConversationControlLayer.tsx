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

/*
  The bottom of a content column that sits under this layer, as a class rather than a utility.

  `dock-clear` reserves `--dock-clearance`, which clears the floating menu. A column also has to
  clear the two bottom control circles, and they stand on top of that clearance. The
  short-viewport branch drops the extra reserve again: on a landscape phone 4.5rem of it is most
  of the remaining height, and the lines clear the circles sideways there instead.
*/
export const CONTROL_COLUMN_BOTTOM =
  'pb-[calc(var(--dock-clearance)+4.5rem)] [@media(max-height:34rem)]:pb-[var(--dock-clearance)]';

/*
  Keeps a full-width line out from under the corner circles on a short screen, where the column
  has no room to sit above them.

  Margin, not padding. The lines stretch to the column's width, so padding would inset the text
  and leave the BOX full width, still sitting under the circle and still eating its taps.
*/
export const CONTROL_CLEAR_CORNERS = '[@media(max-height:34rem)]:mx-20';

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
 * The four physically anchored controls of the `/audio` and `/video` conversations.
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
 * All four are the same 48 px glass circle with a 20 px glyph and no visible label. A control
 * that is bigger or solid reads as the important one, and on this screen none of them is: the
 * conversation is.
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
      // Icon-only like the other three. The word under it was the one label in the layer and
      // made End the odd control out; the red handset already says what it does, and the name
      // still reaches a screen reader and voice control through `aria-label`.
      label={t('assistant.end')}
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
      // is double speak, and the slash on the glyph already carries the state.
      label={t(isMicMuted ? 'assistant.mic.unmute' : 'assistant.mic.mute')}
      // The same circle and the same glyph size as the other three. It used to be a 64 px
      // solid accent disc, which made it the loudest thing on a screen whose subject is the
      // person talking. Mute still reads at a glance: the icon carries the slash.
      icon={<MicIcon muted={isMicMuted} className="size-5" />}
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

import { useEffect, useId, useRef, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibrarySuggestion } from '@/entities/library-entry';
import { useOnlineStatus } from '@/shared/hooks';
import { Button } from '@/shared/ui';
import { CONTACT_CHANNELS, formatPhoneNumber } from './contactChannels';
import { SuggestedQuestions } from './SuggestedQuestions';

interface OfferProps {
  /** After a recorded answer (REQ-075). */
  form: 'offer';
  isConsultDisabled: boolean;
  /** The live start, the same flow as Start. */
  onConsult: () => void;
  /** Up to three. None, or a failed request: the part is not rendered. */
  followUps: LibrarySuggestion[];
  onSelectFollowUp: (entry: LibrarySuggestion) => void;
  /** "Other questions": back to the suggestion list (REQ-061). */
  onBack: () => void;
}

interface FallbackProps {
  /**
   * Under the existing error after a failed start from the lead card (REQ-078): the message in
   * place of the button, and the contact card. Status is `error`, so no follow-ups, and no way
   * back to a list that is not shown.
   */
  form: 'fallback';
}

export type LeadCardProps = OfferProps | FallbackProps;

/**
 * What the visitor can do after a recorded answer (REQ-075): request a consultation with the live
 * assistant, contact the company, or play a related question. A region named by its heading.
 * The offer takes the keyboard focus to its heading as it appears (REQ-061); the fallback leaves
 * it on the error above it, which the page focuses.
 */
export function LeadCard(props: LeadCardProps) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const headingId = useId();
  const hintId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isOffer = props.form === 'offer';

  useEffect(() => {
    if (isOffer) headingRef.current?.focus();
  }, [isOffer]);

  return (
    <section
      aria-labelledby={headingId}
      className="glass flex w-full flex-col gap-4 rounded-3xl p-4 text-start"
    >
      <h2
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="text-base font-semibold text-foreground outline-none"
      >
        {t('library.lead.title')}
      </h2>

      {props.form === 'offer' ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            fullWidth
            isDisabled={props.isConsultDisabled}
            onPress={props.onConsult}
            aria-describedby={hintId}
            className="min-h-11"
          >
            {t('library.lead.consult')}
          </Button>
          <p id={hintId} className="text-sm text-muted">
            {t('library.lead.consultHint')}
          </p>
        </div>
      ) : (
        <p className="text-sm text-foreground">{t('library.lead.liveUnavailable')}</p>
      )}

      <ContactCard />

      {props.form === 'offer' && props.followUps.length > 0 && (
        <SuggestedQuestions
          title={t('library.lead.followUpsTitle')}
          items={props.followUps}
          onSelect={props.onSelectFollowUp}
          pendingId={null}
          isDisabled={!isOnline}
          focusId={null}
        />
      )}

      {props.form === 'offer' && (
        <Button variant="secondary" fullWidth onPress={props.onBack} className="min-h-11">
          {t('library.lead.backToQuestions')}
        </Button>
      )}
    </section>
  );
}

/**
 * The contact channels of REQ-076, one per row, each row a full-width 44 px link. Every value
 * comes from `contactChannels.ts` (SEC-007). They stay usable offline: calling needs no data.
 */
function ContactCard() {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const { phones, email, website } = CONTACT_CHANNELS;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {t('library.lead.contactTitle')}
      </h3>
      <ul className="flex flex-col">
        {phones.map((phone) => {
          const label = t(`library.lead.${phone.label}`);
          const number = formatPhoneNumber(phone.number, i18n.language);
          return (
            <li key={phone.href}>
              <ContactLink
                href={phone.href}
                aria-label={t('library.lead.callLabel', { label, number })}
                label={label}
                value={number}
              />
            </li>
          );
        })}
        <li>
          <ContactLink href={email.href} label={t('library.lead.email')} value={email.address} />
        </li>
        <li>
          <ContactLink
            href={website.href}
            // A plain link: the browser, or the system browser in the app, opens it.
            target="_blank"
            rel="noopener noreferrer"
            label={t('library.lead.website')}
            value={website.address}
          />
        </li>
      </ul>
    </section>
  );
}

function ContactLink({
  label,
  value,
  ...anchor
}: { label: string; value: string } & ComponentProps<'a'>) {
  return (
    <a
      {...anchor}
      className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="text-muted">{label}</span>{' '}
      {/* Numbers and addresses stay `ltr` inside a Persian card too, so the groups keep their
          order. */}
      {/* The app's link style (`PhoneLoginForm`), so a number reads as something to tap. The
          whole row is the link, so hovering anywhere on it colours the value. */}
      <span
        dir="ltr"
        className="font-medium text-foreground underline underline-offset-4 group-hover:text-accent"
      >
        {value}
      </span>
    </a>
  );
}

// Must match the active row in public.consent_versions. The server rejects other versions, so
// changing this text requires a new migration with a new version id.
export const CONSENT_VERSION = '2026-10-v1';

export const CONSENT_PURPOSE =
  'Share my location with authorised school safety administrators for the duration of this commute so they can help if I raise an SOS or do not arrive safely.';

export const CONSENT_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Why location is needed',
    body: 'So the school safety team can see where you are if you raise an SOS or do not confirm safe arrival.',
  },
  {
    title: 'Who can see it',
    body: 'Only safety administrators authorised for your school. Other staff cannot see your location.',
  },
  {
    title: 'When collection starts',
    body: 'Only after you approve this journey and Android grants location permission. Nothing is collected when you sign in or open the app.',
  },
  {
    title: 'How long it lasts',
    body: 'Until you confirm safe arrival, tap Stop Sharing, or the expiry time you choose (at most 12 hours).',
  },
  {
    title: 'How to stop',
    body: 'Tap Stop Sharing at any time. You do not need anyone’s approval to stop.',
  },
  {
    title: 'When the journey expires',
    body: 'Sharing ends automatically. The server refuses any further location from this journey, even if your phone is offline at the time.',
  },
  {
    title: 'If GPS or network is unavailable',
    body: 'Updates pause. The app and the safety team see the time of your last successful update, never an old position shown as live.',
  },
  {
    title: 'Saying no',
    body: 'Sharing is voluntary. Declining has no penalty and does not start any tracking.',
  },
];

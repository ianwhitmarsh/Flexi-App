/**
 * Legal documents, versioned in one place.
 *
 * The text is PLACEHOLDER. BIG-56 NG-2 puts drafting the real agreements with
 * counsel out of scope, so this wires in the structure and marks every document
 * unmistakably until the real text arrives. `isPlaceholder` drives that banner —
 * flip it per document as each is replaced.
 *
 * `version` is the value a future `legal_acceptances` row will reference
 * (BIG-56 AC-5), which is why it lives here rather than inside the screens: an
 * acceptance record and the screen a user read must agree on one identifier.
 */

export type LegalDocId = 'terms' | 'privacy' | 'worker-agreement' | 'employer-agreement';

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  /** Referenced by acceptance records. Bump when the text materially changes. */
  version: string;
  /** ISO date (yyyy-mm-dd). */
  updated: string;
  isPlaceholder: boolean;
  /** Rendered as paragraphs in order. */
  body: string[];
}

const PLACEHOLDER_TAIL = [
  'This document is a placeholder. It is not a binding agreement and does not ' +
    'reflect legal advice. Flexi will replace it with counsel-reviewed text ' +
    'before launch.',
];

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  terms: {
    id: 'terms',
    title: 'Terms of Service',
    version: '0.1.0-draft',
    updated: '2026-07-27',
    isPlaceholder: true,
    body: [
      'These terms will govern your use of Flexi, the marketplace connecting ' +
        'workers with local shifts.',
      'Flexi acts as the W-2 employer of record for workers placed through the ' +
        'platform. Businesses contract with Flexi for staffing rather than ' +
        'employing workers directly.',
      ...PLACEHOLDER_TAIL,
    ],
  },
  privacy: {
    id: 'privacy',
    title: 'Privacy Policy',
    version: '0.1.0-draft',
    updated: '2026-07-27',
    isPlaceholder: true,
    body: [
      'This policy will describe what Flexi collects, why, and how long it is kept.',
      'Flexi expects to collect: identity documents for employment eligibility, ' +
        'precise location at clock-in and clock-out to confirm you were on site, ' +
        'contact details, and employment and payroll records.',
      'Payroll and tax records are retained after account deletion where law ' +
        'requires it. Everything else is removed.',
      ...PLACEHOLDER_TAIL,
    ],
  },
  'worker-agreement': {
    id: 'worker-agreement',
    title: 'Worker Employment Agreement',
    version: '0.1.0-draft',
    updated: '2026-07-27',
    isPlaceholder: true,
    body: [
      'This agreement will set out the terms of your W-2 employment with Flexi.',
      'It will cover wage rates, the same-day pay commitment, timekeeping and ' +
        'clock-in requirements, cancellation and no-show expectations, and the ' +
        'workers compensation cover that applies to your shifts.',
      ...PLACEHOLDER_TAIL,
    ],
  },
  'employer-agreement': {
    id: 'employer-agreement',
    title: 'Employer Service Agreement',
    version: '0.1.0-draft',
    updated: '2026-07-27',
    isPlaceholder: true,
    body: [
      'This agreement will set out the terms under which a business engages ' +
        'Flexi for staffing.',
      'It will cover the bill rate and how it is calculated, payment and escrow ' +
        'terms, cancellation windows, and the division of responsibility given ' +
        'that Flexi rather than the business employs the worker.',
      ...PLACEHOLDER_TAIL,
    ],
  },
};

/** Stable render order, used by every list of documents. */
export const LEGAL_DOC_ORDER: LegalDocId[] = [
  'terms',
  'privacy',
  'worker-agreement',
  'employer-agreement',
];

export function getLegalDoc(id: string): LegalDoc | undefined {
  return LEGAL_DOCS[id as LegalDocId];
}

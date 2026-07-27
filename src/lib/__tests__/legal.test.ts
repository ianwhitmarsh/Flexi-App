/**
 * Legal document catalogue (BIG-70).
 *
 * The screens are UI, but the catalogue is data — and it is the half that has
 * to stay correct: a `legal_acceptances` row will reference these versions
 * (BIG-56 AC-5), so a document losing its version, or the placeholder banner
 * silently switching off before real text lands, are both real hazards.
 */

import { LEGAL_DOCS, LEGAL_DOC_ORDER, getLegalDoc } from '../../constants/legal';

describe('legal document catalogue', () => {
  it('lists exactly the four documents App Store submission needs', () => {
    expect(LEGAL_DOC_ORDER).toEqual([
      'terms',
      'privacy',
      'worker-agreement',
      'employer-agreement',
    ]);
  });

  it('gives every document a version and an ISO date', () => {
    for (const id of LEGAL_DOC_ORDER) {
      const doc = LEGAL_DOCS[id];
      expect(doc.title).toBeTruthy();
      expect(doc.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.body.length).toBeGreaterThan(0);
    }
  });

  it('keeps ids self-consistent, so an acceptance record cannot point at the wrong doc', () => {
    for (const id of LEGAL_DOC_ORDER) {
      expect(LEGAL_DOCS[id].id).toBe(id);
    }
  });

  /**
   * Guards the thing that would actually hurt: text still being a stand-in
   * while the on-screen banner has been switched off. Delete this case only
   * when counsel-reviewed text lands.
   */
  it('marks every placeholder document as such, in the body as well as the flag', () => {
    for (const id of LEGAL_DOC_ORDER) {
      const doc = LEGAL_DOCS[id];
      expect(doc.isPlaceholder).toBe(true);
      expect(doc.body.join(' ')).toContain('placeholder');
    }
  });

  it('resolves known ids and rejects unknown ones', () => {
    expect(getLegalDoc('terms')?.title).toBe('Terms of Service');
    expect(getLegalDoc('nope')).toBeUndefined();
    expect(getLegalDoc('')).toBeUndefined();
  });
});

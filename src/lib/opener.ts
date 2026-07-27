/**
 * Sample-opener templating for the employer voice profile (BIG-39).
 *
 * Deliberately string templating and nothing else: no model is called here, and
 * none should be. Generating the real opener is separate work. This lives in
 * `lib` rather than beside the form so it stays a pure function with no UI
 * imports behind it.
 */

import type { AiProfile, AiTone } from './types';

/** One greeting per tone, so the preview visibly responds to the tone choice. */
const GREETING: Record<AiTone, (company: string) => string> = {
  casual: (c) => `Hey! Thanks for the interest in the shift at ${c}.`,
  professional: (c) => `Hello, and thank you for your interest in this shift at ${c}.`,
  warm: (c) => `Hi there — so glad you're interested in joining us at ${c}.`,
};

/**
 * Assemble a sample opener from whatever has been filled in so far. Every
 * clause is conditional, so a half-filled profile still previews cleanly and an
 * empty one still reads as a sentence.
 */
export function buildOpenerPreview(company: string, p: AiProfile): string {
  const name = company.trim() || 'our business';
  const lines: string[] = [GREETING[p.tone ?? 'warm'](name)];

  if (p.whatMakesUsDifferent?.trim()) lines.push(p.whatMakesUsDifferent.trim());
  if (p.dressCode?.trim()) lines.push(`What to wear: ${p.dressCode.trim()}`);
  if (p.arrivalInstructions?.trim()) lines.push(`Getting in: ${p.arrivalInstructions.trim()}`);
  if (p.parkingNotes?.trim()) lines.push(`Parking: ${p.parkingNotes.trim()}`);

  const faq = (p.faqs ?? []).find((f) => f.question.trim() && f.answer.trim());
  if (faq) lines.push(`${faq.question.trim()} — ${faq.answer.trim()}`);

  lines.push('Any questions before the shift?');
  return lines.join('\n\n');
}

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

/** Who and what the opener is about, when that is known. */
export interface OpenerContext {
  /** The worker's first name, so the opener greets a person. */
  workerFirstName?: string;
  /** The shift they showed interest in. */
  shiftTitle?: string;
}

/**
 * Assemble an opener from whatever has been filled in so far. Every clause is
 * conditional, so a half-filled profile still reads cleanly and an empty one
 * still produces a coherent, shift-specific message.
 */
export function buildOpener(company: string, p: AiProfile, ctx: OpenerContext = {}): string {
  const name = company.trim() || 'our business';
  const worker = ctx.workerFirstName?.trim();
  const shift = ctx.shiftTitle?.trim();

  // The greeting carries the tone; the name and shift are appended so an
  // employer with no profile at all still gets something specific to say.
  let greeting = GREETING[p.tone ?? 'warm'](name);
  if (worker) greeting = `${worker} — ${greeting.charAt(0).toLowerCase()}${greeting.slice(1)}`;
  const lines: string[] = [greeting];
  if (shift) lines.push(`This is for ${shift}.`);

  if (p.whatMakesUsDifferent?.trim()) lines.push(p.whatMakesUsDifferent.trim());
  if (p.dressCode?.trim()) lines.push(`What to wear: ${p.dressCode.trim()}`);
  if (p.arrivalInstructions?.trim()) lines.push(`Getting in: ${p.arrivalInstructions.trim()}`);
  if (p.parkingNotes?.trim()) lines.push(`Parking: ${p.parkingNotes.trim()}`);

  const faq = (p.faqs ?? []).find((f) => f.question.trim() && f.answer.trim());
  if (faq) lines.push(`${faq.question.trim()} — ${faq.answer.trim()}`);

  lines.push('Any questions before the shift?');
  return lines.join('\n\n');
}

/**
 * The sample shown while an employer edits their voice profile. No worker or
 * shift exists at that point, so it is `buildOpener` with no context.
 */
export function buildOpenerPreview(company: string, p: AiProfile): string {
  return buildOpener(company, p);
}

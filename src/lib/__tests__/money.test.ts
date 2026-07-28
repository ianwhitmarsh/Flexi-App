/**
 * Dollars in, cents stored, dollars out (BIG-88).
 *
 * These two functions are the only places in the app where a money value
 * changes representation, so they are the only places a cent can be lost.
 */

import { centsToInput, dollarsToCents, formatRate } from '../util';

describe('dollarsToCents', () => {
  it('takes whole dollars', () => {
    expect(dollarsToCents('22')).toBe(2200);
    expect(dollarsToCents('0')).toBe(0);
  });

  it('takes dollars and cents', () => {
    expect(dollarsToCents('18.50')).toBe(1850);
    expect(dollarsToCents('18.5')).toBe(1850);
    expect(dollarsToCents('0.05')).toBe(5);
  });

  it('does not lose a cent to binary floating point', () => {
    // The reason `Math.round` is there rather than `Math.trunc` or a bare cast.
    // In IEEE 754 these products land just under the integer they should be:
    //   16.15 * 100 === 1614.9999999999998
    //   16.06 * 100 === 1605.9999999999998
    // so truncating pays a worker a cent an hour less than they agreed to.
    //
    // Not a rare corner: 71 of the 1501 rates between $15.00 and $30.00 do
    // this. Asserting the underflow first, so this test still means something
    // if a future engine changes the arithmetic.
    expect(16.15 * 100).toBeLessThan(1615);
    expect(16.06 * 100).toBeLessThan(1606);

    expect(dollarsToCents('16.15')).toBe(1615);
    expect(dollarsToCents('16.06')).toBe(1606);
    expect(dollarsToCents('0.29')).toBe(29);
    expect(dollarsToCents('1.15')).toBe(115);
  });

  it('tolerates a typed dollar sign and stray spacing', () => {
    expect(dollarsToCents(' $18.50 ')).toBe(1850);
  });

  it('refuses anything that is not money', () => {
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents('-5')).toBeNull();
    expect(dollarsToCents('1e3')).toBeNull();
    expect(dollarsToCents('18.')).toBeNull();
  });

  it('refuses more precision than a cent rather than rounding it away', () => {
    // Silently turning the 18.999 somebody typed into $19.00 changes the pay a
    // worker is promised. Refusing it makes them retype; rounding would not
    // tell them anything happened.
    expect(dollarsToCents('18.999')).toBeNull();
    expect(dollarsToCents('0.005')).toBeNull();
  });
});

describe('formatRate', () => {
  it('leaves whole dollars bare, exactly as before the change', () => {
    // Every seeded rate is a whole number, so this is what almost every card
    // in the app renders. `$22/hour`, not `$22.00/hour`.
    expect(formatRate(2200)).toBe('$22');
    expect(formatRate(0)).toBe('$0');
  });

  it('gives cents the second digit money is written with', () => {
    // Stored as a number, 18.5 rendered as `$18.5`. That was the bug.
    expect(formatRate(1850)).toBe('$18.50');
    expect(formatRate(1855)).toBe('$18.55');
    expect(formatRate(5)).toBe('$0.05');
  });
});

describe('the round trip', () => {
  it('returns what was typed, for whole dollars and for cents', () => {
    for (const typed of ['22', '18.50', '8.15', '0.05', '105.99']) {
      const cents = dollarsToCents(typed);
      expect(cents).not.toBeNull();
      expect(centsToInput(cents as number)).toBe(Number(typed) % 1 === 0 ? String(Number(typed)) : typed);
      expect(formatRate(cents as number)).toBe(`$${centsToInput(cents as number)}`);
    }
  });

  it('survives a value going out to an input and back unchanged', () => {
    // What editing a worker profile does: cents → text field → cents.
    for (const cents of [2200, 1850, 815, 5, 10599]) {
      expect(dollarsToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

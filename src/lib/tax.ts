import Decimal from "decimal.js";
import { money, moneyRound } from "./money";
import { DEFAULT_TAX_RATE } from "./constants";

/**
 * Tax calculation utilities.
 * Taiwan VAT default rate: 5%
 *
 * All amounts are computed at write time and stored in three columns.
 * Never compute tax at display time.
 */

export interface TaxBreakdown {
  taxIncl: Decimal;
  taxExcl: Decimal;
  taxAmount: Decimal;
}

/** Convert tax-inclusive amount to breakdown */
export function taxInclToBreakdown(
  amountTaxIncl: Decimal.Value,
  taxRate: number = DEFAULT_TAX_RATE
): TaxBreakdown {
  const incl = money(amountTaxIncl);
  const rate = money(taxRate);
  const excl = moneyRound(incl.dividedBy(rate.plus(1)));
  const tax = moneyRound(incl.minus(excl));

  return {
    taxIncl: moneyRound(incl),
    taxExcl: excl,
    taxAmount: tax,
  };
}

/** Convert tax-exclusive amount to breakdown */
export function taxExclToBreakdown(
  amountTaxExcl: Decimal.Value,
  taxRate: number = DEFAULT_TAX_RATE
): TaxBreakdown {
  const excl = money(amountTaxExcl);
  const rate = money(taxRate);
  const tax = moneyRound(excl.times(rate));
  const incl = moneyRound(excl.plus(tax));

  return {
    taxIncl: incl,
    taxExcl: moneyRound(excl),
    taxAmount: tax,
  };
}

/** Create a zero tax breakdown */
export function zeroTaxBreakdown(): TaxBreakdown {
  const zero = money(0);
  return { taxIncl: zero, taxExcl: zero, taxAmount: zero };
}

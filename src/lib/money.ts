import Decimal from "decimal.js";

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Create a Decimal from any input. Use this instead of `new Decimal()` for consistency.
 * NEVER use plain JS `number` for monetary calculations.
 */
export function money(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Add two monetary values */
export function moneyAdd(a: Decimal.Value, b: Decimal.Value): Decimal {
  return money(a).plus(money(b));
}

/** Subtract b from a */
export function moneySub(a: Decimal.Value, b: Decimal.Value): Decimal {
  return money(a).minus(money(b));
}

/** Multiply a monetary value by a rate/quantity */
export function moneyMul(
  amount: Decimal.Value,
  multiplier: Decimal.Value
): Decimal {
  return money(amount).times(money(multiplier));
}

/** Divide a monetary value */
export function moneyDiv(
  amount: Decimal.Value,
  divisor: Decimal.Value
): Decimal {
  return money(amount).dividedBy(money(divisor));
}

/** Round to 4 decimal places (matching DB precision) */
export function moneyRound(value: Decimal.Value): Decimal {
  return money(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Check if a monetary value is zero */
export function moneyIsZero(value: Decimal.Value): boolean {
  return money(value).isZero();
}

/** Check if a monetary value is negative */
export function moneyIsNegative(value: Decimal.Value): boolean {
  return money(value).isNegative();
}

/** Compare: returns -1, 0, or 1 */
export function moneyCompare(
  a: Decimal.Value,
  b: Decimal.Value
): -1 | 0 | 1 {
  const result = money(a).comparedTo(money(b));
  return result as -1 | 0 | 1;
}

/** Format for display: NT$ 1,234.00 */
export function moneyFormat(
  value: Decimal.Value,
  currency: string = "NT$"
): string {
  const d = money(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const formatted = d
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${formatted}`;
}

/** Convert Decimal to string for Prisma storage */
export function moneyToString(value: Decimal.Value): string {
  return money(value).toFixed(4);
}

/** Zero value */
export const ZERO = money(0);

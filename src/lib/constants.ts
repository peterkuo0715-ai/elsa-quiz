// ============================================================
// Platform Configuration Constants
// ============================================================

/** Appreciation period in days after delivery */
export const APPRECIATION_PERIOD_DAYS = parseInt(
  process.env.APPRECIATION_PERIOD_DAYS || "7",
  10
);

/** Payout blackout window (no payout requests allowed) */
export const PAYOUT_BLACKOUT_START_HOUR = parseInt(
  process.env.PAYOUT_BLACKOUT_START_HOUR || "0",
  10
);
export const PAYOUT_BLACKOUT_END_HOUR = parseInt(
  process.env.PAYOUT_BLACKOUT_END_HOUR || "3",
  10
);

/** Default tax rate (Taiwan VAT 5%) */
export const DEFAULT_TAX_RATE = parseFloat(
  process.env.DEFAULT_TAX_RATE || "0.05"
);

/** Idempotency key TTL in hours */
export const IDEMPOTENCY_KEY_TTL_HOURS = 24;

/** Settlement batch chunk size */
export const SETTLEMENT_BATCH_CHUNK_SIZE = 100;

/** Payout max retries */
export const PAYOUT_MAX_RETRIES = 3;

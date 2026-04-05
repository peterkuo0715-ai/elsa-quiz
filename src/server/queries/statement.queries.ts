import { prisma } from "@/server/db";
import { money, moneyFormat, moneyToString, ZERO } from "@/lib/money";
import { LedgerService } from "@/server/services/ledger.service";

/**
 * Get monthly statements for a merchant.
 */
export async function getMerchantStatements(merchantId: string) {
  return prisma.monthlyStatement.findMany({
    where: { merchantId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

/**
 * Generate a monthly statement for a merchant.
 * Aggregates all ledger entries for the given month.
 */
export async function generateMonthlyStatement(
  merchantId: string,
  year: number,
  month: number
) {
  const wallet = await prisma.merchantWallet.findUnique({
    where: { merchantId },
  });
  if (!wallet) throw new Error("Wallet not found");

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  // Get opening balance (last entry before month start)
  const openingEntry = await prisma.walletLedgerEntry.findFirst({
    where: {
      walletId: wallet.id,
      bucket: "AVAILABLE",
      createdAt: { lt: startDate },
    },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  const openingBalance = openingEntry ? money(openingEntry.balanceAfter.toString()) : ZERO;

  // Get all entries for the month
  const entries = await prisma.walletLedgerEntry.findMany({
    where: {
      walletId: wallet.id,
      createdAt: { gte: startDate, lt: endDate },
    },
    orderBy: { createdAt: "asc" },
  });

  // Calculate totals
  let totalIncome = ZERO;
  let totalDeductions = ZERO;
  let totalPayouts = ZERO;

  for (const entry of entries) {
    const amount = money(entry.amountTaxIncl.toString());
    if (amount.isPositive()) {
      if (entry.entryType === "PAYOUT_FAILED_RETURN") {
        // Payout failure return is not income
      } else {
        totalIncome = totalIncome.plus(amount);
      }
    } else {
      if (
        entry.entryType === "PAYOUT_REQUESTED" ||
        entry.entryType === "PAYOUT_SENT"
      ) {
        totalPayouts = totalPayouts.plus(amount.abs());
      } else {
        totalDeductions = totalDeductions.plus(amount.abs());
      }
    }
  }

  // Closing balance
  const closingEntry = await prisma.walletLedgerEntry.findFirst({
    where: {
      walletId: wallet.id,
      bucket: "AVAILABLE",
      createdAt: { lt: endDate },
    },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  const closingBalance = closingEntry ? money(closingEntry.balanceAfter.toString()) : ZERO;

  // Upsert statement
  const statement = await prisma.monthlyStatement.upsert({
    where: {
      merchantId_year_month: { merchantId, year, month },
    },
    update: {
      openingBalanceTaxIncl: moneyToString(openingBalance),
      openingBalanceTaxExcl: moneyToString(openingBalance),
      closingBalanceTaxIncl: moneyToString(closingBalance),
      closingBalanceTaxExcl: moneyToString(closingBalance),
      totalIncomeTaxIncl: moneyToString(totalIncome),
      totalIncomeTaxExcl: moneyToString(totalIncome),
      totalDeductionsTaxIncl: moneyToString(totalDeductions),
      totalDeductionsTaxExcl: moneyToString(totalDeductions),
      totalPayoutsTaxIncl: moneyToString(totalPayouts),
      totalPayoutsTaxExcl: moneyToString(totalPayouts),
      generatedAt: new Date(),
    },
    create: {
      merchantId,
      year,
      month,
      openingBalanceTaxIncl: moneyToString(openingBalance),
      openingBalanceTaxExcl: moneyToString(openingBalance),
      closingBalanceTaxIncl: moneyToString(closingBalance),
      closingBalanceTaxExcl: moneyToString(closingBalance),
      totalIncomeTaxIncl: moneyToString(totalIncome),
      totalIncomeTaxExcl: moneyToString(totalIncome),
      totalDeductionsTaxIncl: moneyToString(totalDeductions),
      totalDeductionsTaxExcl: moneyToString(totalDeductions),
      totalPayoutsTaxIncl: moneyToString(totalPayouts),
      totalPayoutsTaxExcl: moneyToString(totalPayouts),
      generatedAt: new Date(),
    },
  });

  // Create statement items from ledger entries
  await prisma.monthlyStatementItem.deleteMany({
    where: { statementId: statement.id },
  });

  if (entries.length > 0) {
    await prisma.monthlyStatementItem.createMany({
      data: entries.map((e) => ({
        statementId: statement.id,
        date: e.createdAt,
        description: e.description || e.entryType,
        entryType: e.entryType,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        amountTaxIncl: e.amountTaxIncl.toString(),
        amountTaxExcl: e.amountTaxExcl.toString(),
        taxAmount: e.taxAmount.toString(),
        balanceAfterTaxIncl: e.balanceAfter.toString(),
      })),
    });
  }

  return statement;
}

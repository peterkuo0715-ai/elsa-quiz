import { prisma } from "@/server/db";
import { LedgerService } from "@/server/services/ledger.service";
import { money, moneyFormat, ZERO } from "@/lib/money";
import type { WalletBucket } from "@/generated/prisma";

/**
 * Get wallet balances for a merchant.
 * Uses LedgerService to derive balances from ledger entries.
 */
export async function getWalletBalances(merchantId: string) {
  const wallet = await prisma.merchantWallet.findUnique({
    where: { merchantId },
  });

  if (!wallet) {
    return {
      walletId: null,
      isFrozen: false,
      payoutSuspended: false,
      frozenReason: null as string | null,
      pending: ZERO,
      available: ZERO,
      reserved: ZERO,
      inTransit: ZERO,
    };
  }

  const balances = await LedgerService.getBalances(
    prisma as Parameters<typeof LedgerService.getBalances>[0],
    wallet.id
  );

  return {
    walletId: wallet.id,
    isFrozen: wallet.isFrozen,
    payoutSuspended: wallet.payoutSuspended,
    frozenReason: wallet.frozenReason,
    ...balances,
  };
}

/**
 * Get wallet summary for dashboard display.
 */
export async function getWalletDashboardData(merchantId: string) {
  const balances = await getWalletBalances(merchantId);

  // Get monthly totals from ledger
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const wallet = await prisma.merchantWallet.findUnique({
    where: { merchantId },
  });

  if (!wallet) {
    return {
      balances,
      monthlyIncome: ZERO,
      monthlyDeductions: ZERO,
      monthlyNet: ZERO,
    };
  }

  // Sum credits this month
  const credits = await prisma.walletLedgerEntry.aggregate({
    where: {
      walletId: wallet.id,
      createdAt: { gte: monthStart },
      amount: { gt: 0 },
    },
    _sum: { amountTaxIncl: true },
  });

  // Sum debits this month
  const debits = await prisma.walletLedgerEntry.aggregate({
    where: {
      walletId: wallet.id,
      createdAt: { gte: monthStart },
      amount: { lt: 0 },
    },
    _sum: { amountTaxIncl: true },
  });

  const monthlyIncome = credits._sum.amountTaxIncl
    ? money(credits._sum.amountTaxIncl.toString())
    : ZERO;
  const monthlyDeductions = debits._sum.amountTaxIncl
    ? money(debits._sum.amountTaxIncl.toString()).abs()
    : ZERO;
  const monthlyNet = monthlyIncome.minus(monthlyDeductions);

  return {
    balances,
    monthlyIncome,
    monthlyDeductions,
    monthlyNet,
  };
}

/**
 * Get recent ledger entries for a wallet.
 */
export async function getRecentLedgerEntries(
  merchantId: string,
  limit: number = 20
) {
  const wallet = await prisma.merchantWallet.findUnique({
    where: { merchantId },
  });

  if (!wallet) return [];

  return prisma.walletLedgerEntry.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Get all merchant wallets for platform overview.
 */
export async function getAllMerchantWallets(params?: {
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where = params?.search
    ? {
        merchant: {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { taxId: { contains: params.search } },
          ],
        },
      }
    : {};

  const [wallets, total] = await Promise.all([
    prisma.merchantWallet.findMany({
      where,
      include: {
        merchant: {
          select: { id: true, name: true, taxId: true },
        },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.merchantWallet.count({ where }),
  ]);

  // Get balances for each wallet
  const walletsWithBalances = await Promise.all(
    wallets.map(async (wallet) => {
      const balances = await LedgerService.getBalances(
        prisma as Parameters<typeof LedgerService.getBalances>[0],
        wallet.id
      );
      return { ...wallet, balances };
    })
  );

  return {
    wallets: walletsWithBalances,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

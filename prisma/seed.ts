import "dotenv/config";
import { PrismaClient, UserRole, MerchantRiskLevel } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "crypto";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

// Permission codes
const PERMISSIONS = [
  // Payout
  { code: "payout:request", description: "申請提領" },
  { code: "payout:view", description: "查看提領紀錄" },
  { code: "payout:manage_batch", description: "管理提領批次" },
  // Settlement
  { code: "settlement:view", description: "查看結算" },
  { code: "settlement:run_batch", description: "執行結算批次" },
  // Dispute
  { code: "dispute:view", description: "查看爭議" },
  { code: "dispute:respond", description: "回覆爭議" },
  { code: "dispute:manage", description: "管理爭議" },
  // Bank
  { code: "bank:manage", description: "管理銀行帳號" },
  { code: "bank:approve_change", description: "審核銀行帳號變更" },
  // Reserve
  { code: "reserve:manage", description: "管理 Reserve" },
  // Adjustment
  { code: "adjustment:create", description: "建立調整單" },
  { code: "adjustment:view", description: "查看調整單" },
  // Wallet
  { code: "wallet:view", description: "查看 Wallet" },
  { code: "wallet:freeze", description: "凍結/解凍 Wallet" },
  // Override
  { code: "override:state", description: "覆寫狀態" },
  // Proxy
  { code: "proxy:login", description: "代理登入" },
  // Statement
  { code: "statement:view", description: "查看對帳單" },
  { code: "statement:download", description: "下載對帳單" },
  // Reconciliation
  { code: "reconciliation:view", description: "查看對帳明細" },
  // Rules
  { code: "rules:manage", description: "管理平台規則" },
];

// Role -> Permission mappings
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.code), // All permissions
  PLATFORM_FINANCE: [
    "payout:view",
    "payout:manage_batch",
    "settlement:view",
    "settlement:run_batch",
    "dispute:view",
    "dispute:manage",
    "bank:approve_change",
    "reserve:manage",
    "adjustment:create",
    "adjustment:view",
    "wallet:view",
    "statement:view",
    "statement:download",
    "reconciliation:view",
    "rules:manage",
  ],
  PLATFORM_OPS: [
    "payout:view",
    "settlement:view",
    "dispute:view",
    "dispute:manage",
    "adjustment:view",
    "wallet:view",
    "reconciliation:view",
  ],
  MERCHANT_OWNER: [
    "payout:request",
    "payout:view",
    "settlement:view",
    "dispute:view",
    "dispute:respond",
    "bank:manage",
    "wallet:view",
    "statement:view",
    "statement:download",
    "reconciliation:view",
  ],
  MERCHANT_STAFF: [
    "payout:view",
    "settlement:view",
    "dispute:view",
    "wallet:view",
    "reconciliation:view",
  ],
};

async function main() {
  console.log("Seeding database...");

  // 1. Create permissions
  console.log("Creating permissions...");
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description },
      create: perm,
    });
  }

  // 2. Create roles
  console.log("Creating roles...");
  const roles: Record<string, string> = {};
  for (const roleName of Object.values(UserRole)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
    });
    roles[roleName] = role.id;
  }

  // 3. Create role-permission mappings
  console.log("Creating role-permission mappings...");
  for (const [roleName, permCodes] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roles[roleName];
    for (const code of permCodes) {
      const permission = await prisma.permission.findUnique({
        where: { code },
      });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }

  // 4. Create test merchants
  console.log("Creating test merchants...");
  const merchant1 = await prisma.merchant.upsert({
    where: { taxId: "12345678" },
    update: {},
    create: {
      name: "測試商家 A",
      taxId: "12345678",
    },
  });

  const merchant2 = await prisma.merchant.upsert({
    where: { taxId: "87654321" },
    update: {},
    create: {
      name: "測試商家 B",
      taxId: "87654321",
    },
  });

  // 5. Create stores for merchants
  console.log("Creating merchant stores...");
  await prisma.merchantStore.upsert({
    where: { id: "store-a1" },
    update: {},
    create: {
      id: "store-a1",
      merchantId: merchant1.id,
      name: "商家A - 主店",
    },
  });

  await prisma.merchantStore.upsert({
    where: { id: "store-b1" },
    update: {},
    create: {
      id: "store-b1",
      merchantId: merchant2.id,
      name: "商家B - 主店",
    },
  });

  // 6. Create wallets for merchants
  console.log("Creating merchant wallets...");
  await prisma.merchantWallet.upsert({
    where: { merchantId: merchant1.id },
    update: {},
    create: { merchantId: merchant1.id },
  });

  await prisma.merchantWallet.upsert({
    where: { merchantId: merchant2.id },
    update: {},
    create: { merchantId: merchant2.id },
  });

  // 7. Create risk profiles
  console.log("Creating risk profiles...");
  await prisma.merchantRiskProfile.upsert({
    where: { merchantId: merchant1.id },
    update: {},
    create: {
      merchantId: merchant1.id,
      riskLevel: MerchantRiskLevel.LOW,
    },
  });

  await prisma.merchantRiskProfile.upsert({
    where: { merchantId: merchant2.id },
    update: {},
    create: {
      merchantId: merchant2.id,
      riskLevel: MerchantRiskLevel.MEDIUM,
    },
  });

  // 8. Create bank accounts for merchants
  console.log("Creating bank accounts...");
  await prisma.merchantBankAccount.upsert({
    where: { id: "bank-a1" },
    update: {},
    create: {
      id: "bank-a1",
      merchantId: merchant1.id,
      bankCode: "004",
      bankName: "台灣銀行",
      branchCode: "0012",
      branchName: "信義分行",
      accountNumber: "012345678901",
      accountName: "測試商家A有限公司",
    },
  });

  await prisma.merchantBankAccount.upsert({
    where: { id: "bank-b1" },
    update: {},
    create: {
      id: "bank-b1",
      merchantId: merchant2.id,
      bankCode: "812",
      bankName: "台新銀行",
      branchCode: "0088",
      branchName: "南京分行",
      accountNumber: "987654321012",
      accountName: "測試商家B有限公司",
    },
  });

  // 9. Create test users
  console.log("Creating test users...");
  const defaultPassword = hashPassword("12345678");

  // Super Admin
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@hi5.com" },
    update: {},
    create: {
      email: "admin@hi5.com",
      name: "超級管理員",
      hashedPassword: defaultPassword,
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: roles.SUPER_ADMIN } },
    update: {},
    create: { userId: adminUser.id, roleId: roles.SUPER_ADMIN },
  });

  // Platform Finance
  const financeUser = await prisma.user.upsert({
    where: { email: "finance@hi5.com" },
    update: {},
    create: {
      email: "finance@hi5.com",
      name: "財務人員",
      hashedPassword: defaultPassword,
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: financeUser.id, roleId: roles.PLATFORM_FINANCE } },
    update: {},
    create: { userId: financeUser.id, roleId: roles.PLATFORM_FINANCE },
  });

  // Merchant Owner A
  const merchantUserA = await prisma.user.upsert({
    where: { email: "owner@merchant-a.com" },
    update: {},
    create: {
      email: "owner@merchant-a.com",
      name: "商家A負責人",
      hashedPassword: defaultPassword,
      merchantId: merchant1.id,
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: merchantUserA.id, roleId: roles.MERCHANT_OWNER } },
    update: {},
    create: { userId: merchantUserA.id, roleId: roles.MERCHANT_OWNER },
  });

  // Merchant Owner B
  const merchantUserB = await prisma.user.upsert({
    where: { email: "owner@merchant-b.com" },
    update: {},
    create: {
      email: "owner@merchant-b.com",
      name: "商家B負責人",
      hashedPassword: defaultPassword,
      merchantId: merchant2.id,
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId: merchantUserB.id, roleId: roles.MERCHANT_OWNER } },
    update: {},
    create: { userId: merchantUserB.id, roleId: roles.MERCHANT_OWNER },
  });

  console.log("\nSeed completed successfully!");
  console.log("\nTest accounts:");
  console.log("  admin@hi5.com / 12345678 (Super Admin)");
  console.log("  finance@hi5.com / 12345678 (Platform Finance)");
  console.log("  owner@merchant-a.com / 12345678 (Merchant A Owner)");
  console.log("  owner@merchant-b.com / 12345678 (Merchant B Owner)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

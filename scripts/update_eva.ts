import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: "postgresql://neondb_owner:npg_Z4hs5NfHmrQF@ep-polished-surf-anvanbz5.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require" });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find eva user
  const users = await prisma.user.findMany();
  console.log("All users:");
  for (const u of users) {
    console.log(`  ${u.email} | ${u.name} | merchantId: ${u.merchantId}`);
  }

  // Find any user with 'eva' in name or email
  const eva = users.find(u => u.name.toLowerCase().includes("eva") || u.email.toLowerCase().includes("eva"));
  if (eva) {
    console.log("\nFound eva:", eva.email);
    await prisma.user.update({ where: { id: eva.id }, data: { email: "eva@hi5.com.tw" } });
    console.log("Updated to: eva@hi5.com.tw");
  } else {
    console.log("\nNo eva user found");
  }

  await prisma.$disconnect();
}
main().catch(console.error);

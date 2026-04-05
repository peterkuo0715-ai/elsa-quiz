import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserRole } from "@/generated/prisma";
import { MerchantSidebar } from "@/components/layouts/merchant-sidebar";

export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const allowedRoles: UserRole[] = [
    UserRole.MERCHANT_OWNER,
    UserRole.MERCHANT_STAFF,
    UserRole.SUPER_ADMIN,
  ];

  if (!session.user.roles.some((r) => allowedRoles.includes(r))) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen">
      <MerchantSidebar />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserRole } from "@/generated/prisma";
import { PlatformSidebar } from "@/components/layouts/platform-sidebar";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const allowedRoles: UserRole[] = [
    UserRole.PLATFORM_FINANCE,
    UserRole.PLATFORM_OPS,
    UserRole.SUPER_ADMIN,
  ];

  if (!session.user.roles.some((r) => allowedRoles.includes(r))) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen">
      <PlatformSidebar />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}

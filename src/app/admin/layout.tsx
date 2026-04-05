import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserRole } from "@/generated/prisma";
import { AdminSidebar } from "@/components/layouts/admin-sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!session.user.roles.includes(UserRole.SUPER_ADMIN)) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen">
      <AdminSidebar />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}

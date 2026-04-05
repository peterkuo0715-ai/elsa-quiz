import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserRole } from "@/generated/prisma";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const roles = session.user.roles;
  if (
    roles.includes(UserRole.SUPER_ADMIN) ||
    roles.includes(UserRole.PLATFORM_FINANCE) ||
    roles.includes(UserRole.PLATFORM_OPS)
  ) {
    redirect("/platform/dashboard");
  }

  redirect("/dashboard");
}

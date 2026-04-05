import { auth } from "./auth";
import { UserRole } from "@/generated/prisma";
import { redirect } from "next/navigation";

/**
 * Get the current session or redirect to login.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/**
 * Require the user to have at least one of the specified roles.
 */
export async function requireRole(...roles: UserRole[]) {
  const session = await requireAuth();
  const hasRole = session.user.roles.some((r) => roles.includes(r));
  if (!hasRole) {
    throw new Error("Forbidden: insufficient role");
  }
  return session;
}

/**
 * Require the user to have a specific permission.
 */
export async function requirePermission(permission: string) {
  const session = await requireAuth();
  // SUPER_ADMIN bypasses all permission checks
  if (session.user.roles.includes(UserRole.SUPER_ADMIN)) {
    return session;
  }
  if (!session.user.permissions.includes(permission)) {
    throw new Error(`Forbidden: missing permission ${permission}`);
  }
  return session;
}

/**
 * Require the user to belong to a specific merchant.
 * SUPER_ADMIN and PLATFORM_FINANCE bypass this check.
 */
export async function requireMerchant(merchantId: string) {
  const session = await requireAuth();
  const bypassRoles: UserRole[] = [
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_FINANCE,
    UserRole.PLATFORM_OPS,
  ];
  if (session.user.roles.some((r) => bypassRoles.includes(r))) {
    return session;
  }
  if (session.user.merchantId !== merchantId) {
    throw new Error("Forbidden: merchant access denied");
  }
  return session;
}

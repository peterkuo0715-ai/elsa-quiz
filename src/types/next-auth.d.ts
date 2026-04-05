import { UserRole } from "@/generated/prisma";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      roles: UserRole[];
      permissions: string[];
      merchantId: string | null;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    roles: UserRole[];
    permissions: string[];
    merchantId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    roles: UserRole[];
    permissions: string[];
    merchantId: string | null;
  }
}

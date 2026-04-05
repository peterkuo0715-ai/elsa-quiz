import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/server/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (!user || !user.isActive) return null;

        const roles = user.userRoles.map((ur) => ur.role.name);
        const permissions = [
          ...new Set(
            user.userRoles.flatMap((ur) =>
              ur.role.rolePermissions.map((rp) => rp.permission.code)
            )
          ),
        ];

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          permissions,
          merchantId: user.merchantId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = user.roles;
        token.permissions = user.permissions;
        token.merchantId = user.merchantId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.roles = token.roles as import("@/generated/prisma").UserRole[];
      session.user.permissions = token.permissions as string[];
      session.user.merchantId = token.merchantId as string | null;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});

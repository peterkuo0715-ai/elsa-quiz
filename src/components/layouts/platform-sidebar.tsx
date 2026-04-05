"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Wallet,
  Calculator,
  Banknote,
  PenSquare,
  AlertTriangle,
  Building2,
  Shield,
  Settings,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";

const navItems = [
  { label: "總覽", href: "/platform/dashboard", icon: LayoutDashboard },
  { label: "商家總帳", href: "/platform/wallets", icon: Wallet },
  { label: "結算批次", href: "/platform/settlements", icon: Calculator },
  { label: "提領批次", href: "/platform/payouts", icon: Banknote },
  { label: "手動調整單", href: "/platform/adjustments", icon: PenSquare },
  { label: "爭議管理", href: "/platform/disputes", icon: AlertTriangle },
  { label: "銀行帳號審核", href: "/platform/bank-approvals", icon: Building2 },
  { label: "Reserve 管理", href: "/platform/reserves", icon: Shield },
  { label: "規則設定", href: "/platform/rules", icon: Settings },
];

export function PlatformSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-white">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-lg font-bold">平台財務後台</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          登出
        </button>
      </div>
    </aside>
  );
}

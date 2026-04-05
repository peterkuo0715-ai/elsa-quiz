import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-gray-300">404</h1>
      <p className="mt-4 text-lg text-muted-foreground">找不到此頁面</p>
      <Link href="/" className="mt-6">
        <Button>返回首頁</Button>
      </Link>
    </div>
  );
}

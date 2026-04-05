"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-gray-300">Error</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        發生錯誤，請稍後再試
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message}
      </p>
      <Button onClick={reset} className="mt-6">
        重試
      </Button>
    </div>
  );
}

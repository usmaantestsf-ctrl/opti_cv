"use client";

import React, { useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Alert } from "@/components/Alert";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(data?.message || "Wrong username or password.");
        setIsLoading(false);
        return;
      }

      // Successful login -> navigate to home
      window.location.href = "/";
    } catch {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 min-h-dvh bg-gray-50 dark:bg-slate-900">
      <div className="w-full max-w-sm">
        <Card className="shadow-lg border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              CV Tailor
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Sign in with your assigned credentials
            </p>
          </div>

          <form onSubmit={handleSubmit} method="POST" className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                placeholder="Enter username"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base transition-colors disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                placeholder="Enter password"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base transition-colors disabled:opacity-60"
              />
            </div>

            {error && <Alert type="error" message={error} />}

            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              className="w-full mt-2"
            >
              Log in
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

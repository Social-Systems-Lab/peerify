"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { consumeLoginLink } from "@/lib/auth/actions";

function LoginLinkContent() {
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
    const [message, setMessage] = useState<string>("");

    useEffect(() => {
        const token = searchParams.get("token");
        if (!token) {
            setStatus("error");
            setMessage("No login link token found in URL. Please check the link.");
            return;
        }

        let cancelled = false;
        (async () => {
            const result = await consumeLoginLink(token);
            if (cancelled) return;
            if (result.success) {
                setStatus("success");
                // Full navigation so the server sees the freshly-set session cookie,
                // same as the password-login and email-verification flows.
                window.location.assign(result.handle ? `/circles/${result.handle}` : "/");
            } else {
                setStatus("error");
                setMessage(result.error || "This login link is invalid or has expired.");
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [searchParams]);

    if (status === "checking" || status === "success") {
        return <p className="text-center text-sm text-muted-foreground">Logging you in...</p>;
    }

    return (
        <div className="text-center">
            <p className="text-sm text-red-500">{message}</p>
            <Button asChild className="mt-6">
                <Link href="/login">Back to Login</Link>
            </Button>
        </div>
    );
}

export default function LoginLinkPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 dark:bg-gray-900">
            <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md dark:bg-gray-800">
                <h1 className="mb-6 text-center text-2xl font-semibold text-gray-900 dark:text-white">Log in</h1>
                <Suspense
                    fallback={<p className="text-center text-sm text-muted-foreground">Loading...</p>}
                >
                    <LoginLinkContent />
                </Suspense>
            </div>
        </div>
    );
}

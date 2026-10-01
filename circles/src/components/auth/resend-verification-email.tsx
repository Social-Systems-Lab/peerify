"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    getVerificationResendStatusAction,
    resendVerificationEmailAction,
    type ResendVerificationEmailResult,
    type VerificationResendStatus,
} from "@/app/(auth)/verify-email/actions";

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

type ResendVerificationEmailProps = {
    // Show "We'll send it to <address>" — the check-email page already names the address itself.
    showAddress?: boolean;
    className?: string;
};

const formatWait = (seconds: number): string => {
    if (seconds < 120) {
        return `${seconds}s`;
    }
    if (seconds < 2 * 3600) {
        return `${Math.ceil(seconds / 60)} minutes`;
    }
    return `about ${Math.ceil(seconds / 3600)} hours`;
};

const NOTICE_CLASS: Record<"success" | "error" | "info", string> = {
    success: "text-green-700",
    error: "text-red-600",
    info: "text-[#6b5f52]",
};

export function ResendVerificationEmail({ showAddress = false, className }: ResendVerificationEmailProps) {
    const [state, setState] = useState<"loading" | "signed_out" | "verified" | "ready">("loading");
    const [email, setEmail] = useState("");
    const [waitSeconds, setWaitSeconds] = useState(0);
    const [limitReason, setLimitReason] = useState<"cooldown" | "daily_cap" | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);

    const applyLimit = useCallback((reason: "cooldown" | "daily_cap", retryAfterSeconds: number) => {
        setLimitReason(reason);
        setWaitSeconds(retryAfterSeconds);
    }, []);

    const applyStatus = useCallback(
        (status: VerificationResendStatus | ResendVerificationEmailResult) => {
            switch (status.status) {
                case "unauthenticated":
                    setState("signed_out");
                    return;
                case "already_verified":
                    setState("verified");
                    return;
                case "ready":
                    setEmail(status.email);
                    setState("ready");
                    return;
                case "rate_limited":
                    setEmail(status.email);
                    setState("ready");
                    applyLimit(status.reason, status.retryAfterSeconds);
                    return;
                case "sent":
                    setEmail(status.email);
                    setState("ready");
                    applyLimit("cooldown", status.retryAfterSeconds);
                    return;
                case "failed":
                    setState("ready");
                    return;
            }
        },
        [applyLimit],
    );

    useEffect(() => {
        let cancelled = false;
        getVerificationResendStatusAction()
            .then((status) => {
                if (!cancelled) {
                    applyStatus(status);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setState("ready");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [applyStatus]);

    useEffect(() => {
        if (waitSeconds <= 0) {
            return;
        }
        const timer = setTimeout(() => setWaitSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
        return () => clearTimeout(timer);
    }, [waitSeconds]);

    const handleResend = async () => {
        setIsSending(true);
        setNotice(null);
        try {
            const result = await resendVerificationEmailAction();
            applyStatus(result);
            switch (result.status) {
                case "sent":
                    setNotice({
                        tone: "success",
                        text: `New link sent to ${result.email}. It replaces any earlier link.`,
                    });
                    break;
                case "rate_limited":
                    setNotice(
                        result.reason === "daily_cap"
                            ? {
                                  tone: "error",
                                  text: `You've reached today's resend limit. Try again in ${formatWait(result.retryAfterSeconds)}.`,
                              }
                            : { tone: "info", text: "We just sent one. Please wait a moment before asking again." },
                    );
                    break;
                case "failed":
                    setNotice({ tone: "error", text: result.message });
                    break;
                case "already_verified":
                case "unauthenticated":
                    break;
            }
        } catch {
            setNotice({ tone: "error", text: "Something went wrong. Please try again in a minute." });
        } finally {
            setIsSending(false);
        }
    };

    if (state === "loading") {
        return null;
    }

    if (state === "verified") {
        return (
            <p className={`text-sm text-green-700 ${className ?? ""}`} role="status">
                Your email address is already verified.
            </p>
        );
    }

    if (state === "signed_out") {
        return (
            <p className={`text-sm text-[#6b5f52] ${className ?? ""}`}>
                To get a new link,{" "}
                <Link href="/login" className="text-[#e8720c] underline hover:text-[#ff8c2a]">
                    log in with an email login link
                </Link>
                . That also confirms your address.
            </p>
        );
    }

    const isWaiting = waitSeconds > 0;
    const buttonLabel = isSending
        ? "Sending..."
        : isWaiting && limitReason === "cooldown"
          ? `Resend email (${waitSeconds}s)`
          : "Resend email";

    return (
        <div className={`space-y-2 ${className ?? ""}`}>
            {showAddress && email && (
                <p className="text-sm text-[#6b5f52]">
                    We&apos;ll send it to <span className="font-medium text-[#181512]">{email}</span>.
                </p>
            )}
            <Button type="button" variant="outline" onClick={handleResend} disabled={isSending || isWaiting}>
                {buttonLabel}
            </Button>
            {isWaiting && limitReason === "daily_cap" && !notice && (
                <p className="text-xs text-red-600">
                    You&apos;ve reached today&apos;s resend limit. Try again in {formatWait(waitSeconds)}.
                </p>
            )}
            <p aria-live="polite" className={`text-xs ${notice ? NOTICE_CLASS[notice.tone] : ""}`}>
                {notice?.text}
            </p>
        </div>
    );
}

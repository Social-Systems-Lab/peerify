"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { submitLoginFormAction, requestLoginLinkAction } from "./actions"; // Import the action object
import { useAtom } from "jotai";
import { authInfoAtom, userAtom } from "@/lib/data/atoms";
import { VibeIdAuthButton } from "@/components/auth/vibe-id-auth-button";

// Zod schema based on loginFormSchema
const loginValidationSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"), // Basic check, server handles actual auth
});

type LoginFormData = z.infer<typeof loginValidationSchema>;

const loginLinkEmailSchema = z.string().email("Invalid email address");

type LoginMode = "link" | "password";

export function LoginForm(): React.ReactElement {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [, setUser] = useAtom(userAtom);
    const [, setAuthInfo] = useAtom(authInfoAtom);
    const searchParams = useSearchParams();

    // Defaults to the passwordless option: it works for every account regardless of how
    // it was created (unlike password, which is unusable for pilot-signup accounts), and
    // sidesteps the pre-2026 broken-password population entirely. Password stays one
    // click away via the mode toggle below.
    const [mode, setMode] = useState<LoginMode>("link");

    // "Email me a login link" state — kept in its own <form>, entirely separate from the
    // password form's react-hook-form instance, so no password input ever exists in the
    // same DOM tree. Chrome's saved-password autofill dropdown keys off "a text input
    // followed by a password input in the same form", not the autocomplete attribute
    // alone — so this separation, not an autocomplete tweak, is what actually stops it
    // from popping over this field when the person has no intention of using a password.
    const [linkEmail, setLinkEmail] = useState("");
    const [linkEmailError, setLinkEmailError] = useState<string | null>(null);
    const [isSendingLoginLink, setIsSendingLoginLink] = useState(false);
    const [loginLinkSent, setLoginLinkSent] = useState(false);

    const form = useForm<LoginFormData>({
        resolver: zodResolver(loginValidationSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    });

    const onSubmit = async (data: LoginFormData) => {
        setIsSubmitting(true);
        try {
            // Call the onSubmit method from the imported action object
            const result = await submitLoginFormAction(data);
            if (result.success) {
                toast({
                    title: "Login Successful",
                    description: "Welcome back!",
                });

                // set logged in user and authenticate status
                setUser(result.data.user);
                setAuthInfo((prev) => ({ ...prev, authStatus: "authenticated" }));

                // redirect to requested page
                const redirectUrl = searchParams?.get("redirectTo") ?? `/circles/${result.data.user.handle}`;

                // Use a full navigation after login so the next server-rendered page
                // sees the freshly-set auth cookie/session.
                window.location.assign(redirectUrl);
            } else {
                toast({
                    title: "Login Failed",
                    description: result.message || "Invalid email or password.",
                    variant: "destructive",
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSendLoginLink = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const emailToUse = linkEmail.trim();
        const validation = loginLinkEmailSchema.safeParse(emailToUse);
        if (!validation.success) {
            setLinkEmailError(validation.error.errors[0]?.message || "Enter a valid email address.");
            return;
        }
        setLinkEmailError(null);

        setIsSendingLoginLink(true);
        try {
            const result = await requestLoginLinkAction(emailToUse);
            toast({
                title: result.success ? "Login link sent" : "Request failed",
                description: result.message,
                variant: result.success ? undefined : "destructive",
            });
            if (result.success) {
                setLoginLinkSent(true);
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive",
            });
        } finally {
            setIsSendingLoginLink(false);
        }
    };

    return (
        <div className="formatted mb-4 w-full space-y-6 md:min-w-[400px]">
            <h2 className="text-center text-2xl font-semibold">Login</h2>

            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
                <button
                    type="button"
                    onClick={() => setMode("link")}
                    className={`rounded-sm px-3 py-1.5 font-medium transition-colors ${
                        mode === "link" ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Log in with email link
                </button>
                <button
                    type="button"
                    onClick={() => setMode("password")}
                    className={`rounded-sm px-3 py-1.5 font-medium transition-colors ${
                        mode === "password" ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Log in with password
                </button>
            </div>

            {mode === "link" ? (
                <form onSubmit={handleSendLoginLink} className="space-y-4">
                    {loginLinkSent ? (
                        <p className="text-center text-sm text-muted-foreground">
                            If an account with that email exists, a login link has been sent. Check your inbox (and
                            spam folder).
                        </p>
                    ) : (
                        <>
                            <p className="text-center text-sm text-muted-foreground">
                                We&apos;ll email you a link to log in — no password needed.
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="login-link-email">Email</Label>
                                <Input
                                    id="login-link-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={linkEmail}
                                    onChange={(event) => setLinkEmail(event.target.value)}
                                    autoComplete="email"
                                />
                                {linkEmailError ? <p className="text-sm text-red-600">{linkEmailError}</p> : null}
                            </div>
                            <Button type="submit" disabled={isSendingLoginLink} className="w-full">
                                {isSendingLoginLink ? "Sending..." : "Send login link"}
                            </Button>
                        </>
                    )}
                </form>
            ) : (
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="email"
                                            placeholder="you@example.com"
                                            {...field}
                                            autoComplete="email"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Password</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="password"
                                            placeholder="Enter your password"
                                            {...field}
                                            autoComplete="current-password"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="text-right text-sm">
                            <Link href="/forgot-password" className="text-muted-foreground underline hover:text-primary">
                                Reset password
                            </Link>
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full">
                            {isSubmitting ? "Logging in..." : "Log in"}
                        </Button>
                    </form>
                </Form>
            )}

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-muted-foreground">or</span>
                </div>
            </div>

            <VibeIdAuthButton />

            <div className="text-center text-sm text-muted-foreground">
                Don&#39;t have an account?{" "}
                <Link href="/signup/pilot" className="underline hover:text-primary">
                    Sign up here
                </Link>
            </div>
        </div>
    );
}

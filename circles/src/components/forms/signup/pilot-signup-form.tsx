"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { authInfoAtom, userAtom } from "@/lib/data/atoms";
import { submitSignupFormAction } from "@/components/forms/signup/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

// The role picked on the first signup screen. Only "artist" and "fan" have buttons today,
// but "venue" is already a valid value so a Venue button can be added later without
// reworking this screen or the signup-intent storage.
type SignupRole = "artist" | "fan" | "venue";

type PilotSignupState = {
    firstName: string;
    lastName: string;
    email: string;
    handle: string;
    bandOrVenueName: string;
};

type PilotSignupErrors = Partial<Record<keyof PilotSignupState, string>>;

const initialState: PilotSignupState = {
    firstName: "",
    lastName: "",
    email: "",
    handle: "",
    bandOrVenueName: "",
};

const ROLE_OPTIONS: Array<{ value: SignupRole; title: string; subtitle: string }> = [
    {
        value: "artist",
        title: "Artist / Band",
        subtitle: "Set up your public profile and start reaching fans",
    },
    {
        value: "fan",
        title: "Fan",
        subtitle: "Follow artists, discover shows, pledge support",
    },
];

function sanitizeHandle(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]+/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function getDefaultHandle(firstName: string, lastName: string) {
    return sanitizeHandle(`${firstName} ${lastName}`);
}

function getErrors(state: PilotSignupState, role: SignupRole | null): PilotSignupErrors {
    const errors: PilotSignupErrors = {};

    if (!state.firstName.trim()) {
        errors.firstName = "First name is required.";
    }

    if (!state.lastName.trim()) {
        errors.lastName = "Last name is required.";
    }

    if (!state.email.trim()) {
        errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) {
        errors.email = "Enter a valid email address.";
    }

    if (role === "artist" && !state.bandOrVenueName.trim()) {
        errors.bandOrVenueName = "Band name is required.";
    }

    const handle = sanitizeHandle(state.handle);
    if (!handle) {
        errors.handle = "Handle is required.";
    } else if (handle.length < 3) {
        errors.handle = "Handle must be at least 3 characters.";
    } else if (handle.length > 20) {
        errors.handle = "Handle can't be more than 20 characters.";
    } else if (!/^[a-z0-9-]+$/.test(handle)) {
        errors.handle = "Use lowercase letters, numbers, and hyphens only.";
    }

    return errors;
}

function normalizePeerifyIntent(value: string | null): "fan" | "artist" | "host" | null {
    return value === "fan" || value === "artist" || value === "host" ? value : null;
}

export function PilotSignupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const [, setUser] = useAtom(userAtom);
    const [, setAuthInfo] = useAtom(authInfoAtom);
    const [role, setRole] = useState<SignupRole | null>(null);
    const [state, setState] = useState<PilotSignupState>(initialState);
    const [errors, setErrors] = useState<PilotSignupErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasEditedHandle, setHasEditedHandle] = useState(false);
    const altchaRef = useRef<HTMLElement | null>(null);
    const [altchaPayload, setAltchaPayload] = useState<string | null>(null);

    useEffect(() => {
        import("altcha");
    }, []);

    useEffect(() => {
        const el = altchaRef.current;
        if (!el) return;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.state === "verified" && typeof detail.payload === "string") {
                setAltchaPayload(detail.payload);
            } else {
                setAltchaPayload(null);
            }
        };
        el.addEventListener("statechange", handler as EventListener);
        return () => el.removeEventListener("statechange", handler as EventListener);
        // The altcha-widget only exists in the DOM once a role is picked, so this needs to
        // re-attach once `role` flips from null to a value and the widget actually mounts.
    }, [role]);

    const updateField = (field: keyof PilotSignupState, value: string) => {
        setState((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => ({ ...prev, [field]: undefined }));
    };

    useEffect(() => {
        if (hasEditedHandle) {
            return;
        }

        const nextHandle = getDefaultHandle(state.firstName, state.lastName);
        setState((prev) => (prev.handle === nextHandle ? prev : { ...prev, handle: nextHandle }));
    }, [hasEditedHandle, state.firstName, state.lastName]);

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!role) {
            return;
        }

        const nextErrors = getErrors(state, role);
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        if (!altchaPayload) {
            toast({
                title: "Verification required",
                description: "Please complete the human-verification check.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            const fullName = `${state.firstName.trim()} ${state.lastName.trim()}`.trim();
            const result = await submitSignupFormAction({
                name: fullName,
                handle: sanitizeHandle(state.handle),
                _email: state.email.trim(),
                altcha: altchaPayload,
                metadata: {
                    onboardingFlow: "pilot-quick-signup",
                    signupIntent: role,
                    ...(role === "artist" ? { bandOrVenueName: state.bandOrVenueName.trim() } : {}),
                },
            });

            if (!result.success) {
                const message = result.message || "An error occurred during signup.";
                if (message.toLowerCase().includes("handle")) {
                    setErrors({ handle: message });
                } else if (message.toLowerCase().includes("email")) {
                    setErrors({ email: message });
                } else {
                    toast({
                        title: "Signup failed",
                        description: message,
                        variant: "destructive",
                    });
                }
                return;
            }

            setUser(result.data.user);
            setAuthInfo((prev) => ({ ...prev, authStatus: "authenticated" }));

            toast({
                title: "Account created",
                description: "Now verify your email. You can continue into Peerify after that.",
            });

            const nextParams = new URLSearchParams();
            nextParams.set("email", state.email.trim());
            nextParams.set("handle", result.data.user.handle || sanitizeHandle(state.handle));

            const redirectTo = searchParams?.get("redirectTo");
            if (redirectTo) {
                nextParams.set("redirectTo", redirectTo);
            }

            const peerifyIntent = normalizePeerifyIntent(searchParams?.get("intent") ?? null);
            if (peerifyIntent) {
                nextParams.set("intent", peerifyIntent);
            }

            router.push(`/signup/pilot/check-email?${nextParams.toString()}`);
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

    if (!role) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f7f2ea] px-4 py-10">
                <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                    <CardHeader className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#e8720c]">
                            Peerify Pilot Signup
                        </p>
                        <CardTitle className="text-2xl text-[#181512]">How will you use Peerify?</CardTitle>
                        <p className="text-sm text-[#6b5f52]">Pick what fits best. You can always add more later.</p>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {ROLE_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setRole(option.value)}
                                    className="flex h-full flex-col items-start gap-2 rounded-2xl border border-[#e5d8c7] bg-[#f7f2ea] p-5 text-left transition-colors hover:border-[#e8720c] hover:bg-[#faf6ef]"
                                >
                                    <span className="text-lg font-semibold text-[#181512]">{option.title}</span>
                                    <span className="text-sm text-[#6b5f52]">{option.subtitle}</span>
                                </button>
                            ))}
                        </div>

                        <p className="mt-6 text-center text-sm text-[#6b5f52]">
                            Already have an account?{" "}
                            <Link href="/login" className="underline hover:text-[#181512]">
                                Log in
                            </Link>
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#f7f2ea] px-4 py-10">
            <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardHeader className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#e8720c]">
                        Peerify Pilot Signup
                    </p>
                    <CardTitle className="text-2xl text-[#181512]">Create your personal account</CardTitle>
                    <p className="text-sm text-[#6b5f52]">
                        Signing up as {role === "artist" ? "an Artist / Band" : "a Fan"}.{" "}
                        <button
                            type="button"
                            onClick={() => {
                                setRole(null);
                                setAltchaPayload(null);
                            }}
                            className="underline hover:text-[#181512]"
                        >
                            Change
                        </button>
                    </p>
                </CardHeader>
                <CardContent>
                    <form className="space-y-5" onSubmit={onSubmit}>
                        <div className="grid gap-5 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="pilot-signup-first-name">First name</Label>
                                <Input
                                    id="pilot-signup-first-name"
                                    value={state.firstName}
                                    onChange={(event) => updateField("firstName", event.target.value)}
                                    autoComplete="given-name"
                                    placeholder="Jane"
                                />
                                {errors.firstName ? <p className="text-sm text-red-600">{errors.firstName}</p> : null}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="pilot-signup-last-name">Last name</Label>
                                <Input
                                    id="pilot-signup-last-name"
                                    value={state.lastName}
                                    onChange={(event) => updateField("lastName", event.target.value)}
                                    autoComplete="family-name"
                                    placeholder="Smith"
                                />
                                {errors.lastName ? <p className="text-sm text-red-600">{errors.lastName}</p> : null}
                            </div>
                        </div>

                        {role === "artist" ? (
                            <div className="space-y-2">
                                <Label htmlFor="pilot-signup-band-name">Band name</Label>
                                <Input
                                    id="pilot-signup-band-name"
                                    value={state.bandOrVenueName}
                                    onChange={(event) => updateField("bandOrVenueName", event.target.value)}
                                    placeholder="e.g. The Night Owls"
                                />
                                <p className="text-sm text-[#6b5f52]">
                                    This becomes the name of your public artist profile.
                                </p>
                                {errors.bandOrVenueName ? (
                                    <p className="text-sm text-red-600">{errors.bandOrVenueName}</p>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="space-y-2">
                            <Label htmlFor="pilot-signup-email">Email</Label>
                            <Input
                                id="pilot-signup-email"
                                type="email"
                                value={state.email}
                                onChange={(event) => updateField("email", event.target.value)}
                                autoComplete="email"
                                placeholder="you@example.com"
                            />
                            {errors.email ? <p className="text-sm text-red-600">{errors.email}</p> : null}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="pilot-signup-handle">Handle</Label>
                            <Input
                                id="pilot-signup-handle"
                                value={state.handle}
                                onChange={(event) => {
                                    setHasEditedHandle(true);
                                    updateField("handle", sanitizeHandle(event.target.value));
                                }}
                                autoComplete="nickname"
                                placeholder="your-handle"
                            />
                            <p className="text-sm text-[#6b5f52]">
                                This defaults from your first and last name. You can still edit it before creating
                                your account.
                            </p>
                            {errors.handle ? <p className="text-sm text-red-600">{errors.handle}</p> : null}
                        </div>

                        <altcha-widget ref={altchaRef} challenge="/api/altcha/challenge" />

                        <Button type="submit" disabled={isSubmitting || !altchaPayload} className="w-full">
                            {isSubmitting ? "Creating account..." : "Create account"}
                        </Button>

                        <p className="text-center text-sm text-[#6b5f52]">
                            Already have an account?{" "}
                            <Link href="/login" className="underline hover:text-[#181512]">
                                Log in
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

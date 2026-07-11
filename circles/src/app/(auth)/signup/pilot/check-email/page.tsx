import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = {
    searchParams: Promise<{
        email?: string;
        handle?: string;
        redirectTo?: string;
        intent?: string;
    }>;
};

function normalizePeerifyIntent(value?: string): "fan" | "artist" | "host" | null {
    return value === "fan" || value === "artist" || value === "host" ? value : null;
}

export default async function PilotCheckEmailPage(props: PageProps) {
    const searchParams = await props.searchParams;
    const handle = searchParams.handle?.trim();
    const redirectTo = searchParams.redirectTo?.trim();
    const peerifyIntent = normalizePeerifyIntent(searchParams.intent);
    // A bare "/" redirectTo carries no real destination preference (e.g. it's the fallback the
    // header's Sign Up button used to attach) — prefer sending a brand-new signup to their own
    // profile over the marketing homepage whenever a handle is available.
    const hasMeaningfulRedirect = redirectTo && redirectTo !== "/";
    const continueUrl = hasMeaningfulRedirect
        ? redirectTo
        : handle
          ? `/circles/${handle}/home`
          : "/";

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#f7f2ea] px-4 py-10">
            <Card className="w-full max-w-xl border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardHeader className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#e8720c]">Peerify Pilot Signup</p>
                    <CardTitle className="text-3xl text-[#181512]">Check your email</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-[#6b5f52]">
                        We&apos;ve sent a verification link to{" "}
                        {searchParams.email ? <span className="font-medium text-[#181512]">{searchParams.email}</span> : "your email address"}.
                    </p>
                    <p className="text-base text-[#6b5f52]">
                        Email verification lets you recover your account if you forget your password. Some account and
                        trust features may ask for it later.
                    </p>
                    <p className="text-xs text-[#6b5f52]">
                        Didn&apos;t get the email? Check your spam folder, or{" "}
                        <Link href={continueUrl} className="underline text-[#e8720c] hover:text-[#ff8c2a]">
                            click here
                        </Link>{" "}
                        to go directly to your profile.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

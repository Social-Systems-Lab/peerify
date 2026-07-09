import Link from "next/link";
import { Button } from "@/components/ui/button";
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
                    <p className="text-sm text-[#6b5f52]">
                        We&apos;ve sent a verification link to your email address. You can verify now, or continue into
                        Peerify and come back to it later.
                    </p>
                    <p className="text-sm text-[#6b5f52]">
                        Email verification simply confirms that we can reach you. Some account and trust features may ask
                        for it later.
                    </p>
                    {searchParams.email ? <p className="text-sm font-medium text-[#181512]">{searchParams.email}</p> : null}
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-lg border border-[#e3d5c2] bg-white/70 p-4 text-sm text-[#181512]">
                        <div className="font-medium">Recommended next step</div>
                        <p className="mt-1">Open the verification link we sent to your email, then continue setting up your Peerify profile.</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button asChild className="bg-[#e8720c] text-[#181512] hover:bg-[#ff8c2a]">
                            <Link href={continueUrl}>Continue to Peerify</Link>
                        </Button>
                        <Button asChild variant="outline">
                            <Link href="/login">Back to login</Link>
                        </Button>
                    </div>

                    <p className="text-sm text-[#6b5f52]">
                        Didn&apos;t get the email? Check your spam folder. We&apos;ll add a resend option soon.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

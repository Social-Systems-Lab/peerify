import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResendVerificationEmail } from "@/components/auth/resend-verification-email";
import PeerifyContactDialog from "@/components/pages/contact/peerify-contact-dialog";

type PageProps = {
    searchParams: Promise<{
        email?: string;
        handle?: string;
        redirectTo?: string;
        intent?: string;
    }>;
};

export default async function PilotCheckEmailPage(props: PageProps) {
    const searchParams = await props.searchParams;

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#f7f2ea] px-4 py-10">
            <Card className="w-full max-w-xl border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardHeader className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#e8720c]">Join Peerify</p>
                    <CardTitle className="text-3xl text-[#181512]">Check your email</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-[#6b5f52]">
                        We&apos;ve sent a verification link to{" "}
                        {searchParams.email ? <span className="font-medium text-[#181512]">{searchParams.email}</span> : "your email address"}.
                    </p>
                    <p className="text-base text-[#6b5f52]">
                        Click the link in your email to finish creating your account and log in. No password
                        needed — we&apos;ll always log you in this way.
                    </p>
                    <p className="text-xs text-[#6b5f52]">
                        Didn&apos;t get the email? Check your spam folder, and that the address above is spelled right.
                    </p>
                    <ResendVerificationEmail />
                    <p className="text-xs text-[#6b5f52]">
                        Still nothing?{" "}
                        <PeerifyContactDialog
                            defaultReason="account_access"
                            trigger={
                                <button type="button" className="text-[#e8720c] underline hover:text-[#ff8c2a]">
                                    Contact us
                                </button>
                            }
                        />
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

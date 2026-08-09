import RedirectButtons from "@/components/redirectPage/redirect-buttons";
import { Card, CardContent } from "@/components/ui/card";

export default function Unauthenticated() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f2ea] px-6 text-center">
            <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardContent className="flex flex-col items-center px-8 py-10">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#e8720c]">Peerify</p>
                    <h1 className="mt-4 text-4xl font-semibold text-[#181512]">You don&apos;t have access</h1>
                    <p className="mt-4 max-w-md text-[#6b5f52]">
                        This page isn&apos;t available to you. If that doesn&apos;t seem right, try signing in again.
                    </p>
                    <RedirectButtons buttons={[{ text: "Go to Home", href: "{redirectTo}" }]} />
                </CardContent>
            </Card>
        </div>
    );
}

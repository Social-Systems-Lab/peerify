import RedirectButtons from "@/components/redirectPage/redirect-buttons";
import { Card, CardContent } from "@/components/ui/card";

export default function LoggedOut() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f2ea] px-6 text-center">
            <Card className="w-full max-w-md border-[#e3d5c2] bg-[#faf6ef] shadow-sm">
                <CardContent className="flex flex-col items-center px-8 py-10">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#e8720c]">Peerify</p>
                    <h1 className="mt-4 text-4xl font-semibold text-[#181512]">You&apos;ve been logged out</h1>
                    <p className="mt-4 max-w-md text-[#6b5f52]">We hope to see you again soon.</p>
                    <RedirectButtons
                        buttons={[
                            { text: "Log in", href: "/login?redirectTo={redirectTo}" },
                            { text: "Return to page", href: "{redirectTo}" },
                        ]}
                    />
                </CardContent>
            </Card>
        </div>
    );
}

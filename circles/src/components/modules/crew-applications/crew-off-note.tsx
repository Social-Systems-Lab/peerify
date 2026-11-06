import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

type CrewOffNoteProps = {
    handle: string;
    // The About page's own Crew toggle (crewEnabled) is off, not just the module.
    aboutToggleOff: boolean;
    pendingCount: number;
};

// Shown to managers on the Crew Dashboard and the Crew Applications page while Crew is switched
// off (isCrewOn). Pending applications stay stored and show again when Crew is switched back on.
export default function CrewOffNote({ handle, aboutToggleOff, pendingCount }: CrewOffNoteProps) {
    return (
        <Card className="rounded-lg border-dashed border-slate-300 bg-slate-50 shadow-none" data-testid="crew-off-note">
            <CardContent className="flex flex-col gap-3 px-6 py-8">
                <h2 className="text-xl font-semibold text-[#231f1a]">Crew is switched off</h2>
                <p className="max-w-2xl text-sm text-slate-600">
                    Fans can&apos;t see or join your Crew right now, and no new applications come in.
                    {pendingCount > 0
                        ? ` ${pendingCount} pending ${pendingCount === 1 ? "application is" : "applications are"} kept and will show here again when you switch Crew back on.`
                        : ""}
                </p>
                <Link
                    href={`/circles/${handle}/settings/pages`}
                    className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                    Switch Crew on in Settings &gt; Modules
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {aboutToggleOff ? (
                    <Link
                        href={`/circles/${handle}/settings/about`}
                        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                        Also switch on the Crew toggle in Settings &gt; About
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                ) : null}
            </CardContent>
        </Card>
    );
}

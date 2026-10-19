import { Events } from "@/lib/data/db";
import { getCircleByHandle, isCirclePublished } from "@/lib/data/circle";
import { canViewerSeeCircleEvents, getEventLocationForViewer } from "@/lib/data/event";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getPublicOrigin, ICS_UID_DOMAIN } from "@/lib/utils/public-origin";

// Helpers for ICS formatting
function pad(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

function toUTCStringBasic(date: Date): string {
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const mm = pad(date.getUTCMinutes());
    const ss = pad(date.getUTCSeconds());
    return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function toDateOnly(date: Date): string {
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    return `${y}${m}${d}`;
}

function addDays(date: Date, days: number): Date {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function escapeICS(text: string | undefined): string {
    if (!text) return "";
    return text
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

// RFC 5545 line folding at 75 octets (approximate by characters here)
function foldLine(line: string): string {
    const max = 75;
    if (line.length <= max) return line;
    const parts: string[] = [];
    let i = 0;
    while (i < line.length) {
        const chunk = line.slice(i, i + max);
        parts.push(i === 0 ? chunk : ` ${chunk}`);
        i += max;
    }
    return parts.join("\r\n");
}

function foldLines(lines: string[]): string {
    return lines.map((l) => foldLine(l)).join("\r\n") + "\r\n";
}

function slugifyForFilename(s: string): string {
    const base = s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "");
    return base || "events";
}

export async function GET(req: Request, ctx: { params: Promise<{ handle: string }> }): Promise<Response> {
    try {
        const { handle } = await ctx.params;
        if (!handle) {
            return new Response("Invalid parameters", { status: 400 });
        }

        const circle = await getCircleByHandle(handle);
        if (!circle || !circle._id || !isCirclePublished(circle)) {
            return new Response("Circle not found", { status: 404 });
        }

        // Same access as the circle's events tab: logged out only for circles whose events are public.
        const userDid = await getAuthenticatedUserDid();
        if (!(await canViewerSeeCircleEvents(circle, userDid))) {
            return new Response("Circle not found", { status: 404 });
        }

        // Only include published, upcoming events for this circle; private ones only for signed-in viewers.
        const now = new Date();
        const circleIdStr = String(circle._id);
        const events = await Events.find({
            circleId: circleIdStr,
            stage: "open",
            endAt: { $gte: now },
            ...(userDid ? {} : { visibility: { $ne: "private" } }),
        })
            .sort({ startAt: 1 })
            .limit(500)
            .toArray();

        // Not new URL(req.url).origin: behind nginx that is the app's own listen address.
        const origin = getPublicOrigin(req.headers, req.url);
        const calName = `${circle.name || circle.handle || "Circle"} Events`;
        const calDesc = `Upcoming events for ${circle.name || circle.handle || "this circle"} on Circles`;

        const lines: string[] = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Circles//Events Feed//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            `X-WR-CALNAME:${escapeICS(calName)}`,
            `X-WR-CALDESC:${escapeICS(calDesc)}`,
        ];

        const dtStamp = toUTCStringBasic(new Date());

        for (const ev of events) {
            const isAllDay = !!ev.allDay;
            const uid = `event-${String(ev._id)}@${ICS_UID_DOMAIN}`;
            const summary = escapeICS(ev.title);
            const description = escapeICS(ev.description);
            const eventUrl = `${origin}/circles/${handle}/events/${String(ev._id)}`;

            lines.push("BEGIN:VEVENT");
            lines.push(`UID:${uid}`);
            lines.push(`DTSTAMP:${dtStamp}`);

            if (isAllDay) {
                lines.push(`DTSTART;VALUE=DATE:${toDateOnly(new Date(ev.startAt))}`);
                lines.push(`DTEND;VALUE=DATE:${toDateOnly(addDays(new Date(ev.endAt), 1))}`);
            } else {
                lines.push(`DTSTART:${toUTCStringBasic(new Date(ev.startAt))}`);
                lines.push(`DTEND:${toUTCStringBasic(new Date(ev.endAt))}`);
            }

            lines.push(`SUMMARY:${summary}`);
            if (description) lines.push(`DESCRIPTION:${description}`);

            // Virtual URL as URL (if available)
            if (ev.virtualUrl) lines.push(`URL:${escapeICS(ev.virtualUrl)}`);
            // Canonical URL to event page (always include)
            lines.push(`URL:${escapeICS(eventUrl)}`);

            // Location (prefer "Online" for virtual)
            if (ev.isVirtual) {
                lines.push("LOCATION:Online");
            } else if (ev.location) {
                // Street only when the event's locationDisclosure allows it for this viewer.
                const location = await getEventLocationForViewer(ev, userDid);
                const parts = [location?.street, location?.city, location?.region, location?.country].filter(Boolean);
                if (parts.length > 0) lines.push(`LOCATION:${escapeICS(parts.join(", "))}`);
            }

            lines.push("END:VEVENT");
        }

        lines.push("END:VCALENDAR");

        const ics = foldLines(lines);
        const filename = `${slugifyForFilename(circle.handle || circle.name || "events")}.ics`;

        return new Response(ics, {
            status: 200,
            headers: {
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": `inline; filename="${filename}"`,
                // Depends on who is asking, so never in a shared cache.
                "Cache-Control": "private, max-age=300",
            },
        });
    } catch (err) {
        console.error("Error generating ICS feed:", err);
        return new Response("Failed to generate ICS feed", { status: 500 });
    }
}

import { Badge } from "@/components/ui/badge";
import { Circle } from "@/models/models";
import { isCircleCreator } from "./circle-creator";

// "Creator" next to the circle's creator (circle.createdBy) in the admin and follower lists
// (2026-11-22). Renders nothing on anyone else's row, or when the circle has no recorded creator.
export function CreatorBadge({ circle, userDid }: { circle: Pick<Circle, "createdBy">; userDid?: string }) {
    if (!isCircleCreator(circle, userDid)) return null;
    return (
        <Badge variant="secondary" className="shrink-0 font-medium" title="Created this circle">
            Creator
        </Badge>
    );
}

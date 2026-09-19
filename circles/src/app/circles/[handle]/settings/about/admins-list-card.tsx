import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import InviteAdminDialog from "@/components/modules/members/invite-admin-dialog";
import { Circle, MemberDisplay } from "@/models/models";

type AdminsListCardProps = {
    circle: Circle;
    admins: MemberDisplay[];
};

// This page's own edit_about gate (defaultUserGroups: ["admins"]) already keeps non-admins off
// the whole page - see the redirect in page.tsx - so this card doesn't need its own check.
export function AdminsListCard({ circle, admins }: AdminsListCardProps) {
    return (
        <div className="mb-6 rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">Admins</h2>
                <InviteAdminDialog circle={circle} />
            </div>
            <div className="space-y-3">
                {admins.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No admins found.</p>
                ) : (
                    admins.map((admin) => (
                        <div key={admin.userDid} className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={admin.picture?.url} />
                                <AvatarFallback>{admin.name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-1 flex-col">
                                <span className="text-sm font-medium">{admin.name}</span>
                                {admin.handle ? (
                                    <span className="text-xs text-muted-foreground">@{admin.handle}</span>
                                ) : null}
                            </div>
                            {admin.joinedAt ? (
                                <span className="text-xs text-muted-foreground">
                                    Since {new Date(admin.joinedAt).toLocaleDateString()}
                                </span>
                            ) : null}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

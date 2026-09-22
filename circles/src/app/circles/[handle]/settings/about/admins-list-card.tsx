import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import CancelAdminInvitationButton from "@/components/modules/members/cancel-admin-invitation-button";
import InviteAdminDialog from "@/components/modules/members/invite-admin-dialog";
import RemoveAdminButton from "@/components/modules/members/remove-admin-button";
import { Circle, MemberDisplay } from "@/models/models";

// Flattened in page.tsx rather than passing raw AdminInvitation docs: the invitee's name/handle/
// picture live on their own Circle (an invitation only stores their did), and userGroups needs
// resolveRoleNames against this circle's configured group titles before it's displayable.
export type PendingAdminInvitationDisplay = {
    requestId: string;
    inviteeName: string;
    inviteeHandle?: string;
    inviteePictureUrl?: string;
    roleNames: string;
    createdAt: Date;
};

type AdminsListCardProps = {
    circle: Circle;
    admins: MemberDisplay[];
    pendingInvitations: PendingAdminInvitationDisplay[];
};

// This page's own edit_about gate (defaultUserGroups: ["admins"]) already keeps non-admins off
// the whole page - see the redirect in page.tsx - so this card doesn't need its own check.
export function AdminsListCard({ circle, admins, pendingInvitations }: AdminsListCardProps) {
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
                            <RemoveAdminButton circle={circle} admin={admin} />
                        </div>
                    ))
                )}
            </div>
            {/* Only the viewer's OWN sent invitations reach this prop (see page.tsx), so there's no
                empty state to render for an admin who simply hasn't invited anyone - the whole
                section stays off until they have something pending. */}
            {pendingInvitations.length > 0 ? (
                <div className="mt-6 border-t pt-4">
                    <h3 className="mb-1 text-sm font-semibold">Pending invitations</h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                        Invitations you&apos;ve sent that haven&apos;t been accepted or declined yet.
                    </p>
                    <div className="space-y-3">
                        {pendingInvitations.map((invitation) => (
                            <div key={invitation.requestId} className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={invitation.inviteePictureUrl} />
                                    <AvatarFallback>{invitation.inviteeName?.[0]}</AvatarFallback>
                                </Avatar>
                                <div className="flex flex-1 flex-col">
                                    <span className="text-sm font-medium">{invitation.inviteeName}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {invitation.inviteeHandle ? `@${invitation.inviteeHandle} · ` : ""}
                                        Invited as {invitation.roleNames}
                                    </span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    Sent {new Date(invitation.createdAt).toLocaleDateString()}
                                </span>
                                <CancelAdminInvitationButton
                                    circle={circle}
                                    requestId={invitation.requestId}
                                    inviteeName={invitation.inviteeName}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

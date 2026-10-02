import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUserDid } from "@/lib/auth/auth";
import { getAdminInvitationForInvitee } from "@/lib/data/admin-invitations";
import { getAdminInvitationPath } from "@/lib/utils/circle-routes";
import AdminInvitationResponse from "@/components/modules/members/admin-invitation-response";

type PageProps = {
    params: Promise<{ invitationId: string }>;
};

// Outside /circles/ so middleware's /api/access check (which 404s non-admins on unpublished
// circles) never runs here. Access is checked below instead: only the invitee sees the page,
// everyone else gets notFound whatever the invitation's status.
export default async function AdminInvitationPage(props: PageProps) {
    const { invitationId } = await props.params;

    // Checked before the login redirect so only a well-formed relative path goes into redirectTo.
    if (!/^[0-9a-f]{24}$/i.test(invitationId)) {
        notFound();
    }

    const userDid = await getAuthenticatedUserDid();
    if (!userDid) {
        redirect(`/login?redirectTo=${encodeURIComponent(getAdminInvitationPath(invitationId))}`);
    }

    const invitation = await getAdminInvitationForInvitee(invitationId, userDid);
    if (!invitation) {
        notFound();
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-start bg-[#f7f2ea] px-4 pt-[10vh] md:pt-[15vh]">
            <AdminInvitationResponse invitation={invitation} />
        </div>
    );
}

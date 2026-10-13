import { autoVerifyUserIfReady, getCircleByHandle } from "./circle";
import { addMember, getMember } from "./member";
import { pinCircle } from "./user";

// The Peerify community circle every new member follows.
export const BACKSTAGE_LOUNGE_HANDLE = "the-backstage-lounge";

// Follows The Backstage Lounge (members row, follower count, members chat via addMember) and pins
// it to the sidebar so the member sees it immediately and discovers the pinning feature itself.
// pinCircle is the same plain, unprivileged mechanism the user's own pin/unpin toggle
// (user-toolbox.tsx) uses: an ordinary pin, not a locked default. Looked up by its stable handle;
// if the circle doesn't exist in this environment, or the user already has a membership row
// (accounts that signed up before enrolment moved here), this does nothing.
export const enrollInBackstageLounge = async (userDid: string): Promise<void> => {
    const lounge = await getCircleByHandle(BACKSTAGE_LOUNGE_HANDLE);
    if (!lounge?._id) {
        return;
    }
    const loungeId = String(lounge._id);
    if (await getMember(userDid, loungeId)) {
        return;
    }
    await addMember(userDid, loungeId, ["members"]);
    await pinCircle(userDid, loungeId);
};

// Runs when an account's isEmailVerified flips false -> true (verifyEmailAction, consumeLoginLink).
// Signup itself no longer enrols anyone: bots sign up with strangers' addresses, and every one of
// them used to become a Lounge follower. Neither step may block the verification that called it.
export const completeFirstEmailVerification = async (user: { _id: unknown; did?: string | null }): Promise<void> => {
    if (!user.did) {
        return;
    }
    try {
        await enrollInBackstageLounge(user.did);
    } catch (error) {
        console.error(`Failed to enroll user ${user.did} in The Backstage Lounge:`, error);
    }
    try {
        // A profile completed before the email was verified gets verified now.
        await autoVerifyUserIfReady(String(user._id));
    } catch (error) {
        console.error(`Failed to run auto-verification for user ${user.did}:`, error);
    }
};

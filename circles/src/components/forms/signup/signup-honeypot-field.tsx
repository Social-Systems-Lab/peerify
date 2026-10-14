import React from "react";

// Name of the hidden honeypot input on both signup forms; submitSignupFormAction refuses a signup
// that fills it. People never see it (moved off-screen, not display:none, which some bots skip),
// it is out of the tab order and hidden from screen readers. Form-filling bots fill it.
export const SIGNUP_HONEYPOT_FIELD = "website";

export function SignupHoneypotField({
    inputRef,
}: {
    inputRef: React.RefObject<HTMLInputElement | null>;
}): React.ReactElement {
    return (
        <div
            aria-hidden="true"
            style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
        >
            <label>
                Website (leave this empty)
                <input
                    ref={inputRef}
                    type="text"
                    name={SIGNUP_HONEYPOT_FIELD}
                    tabIndex={-1}
                    autoComplete="off"
                    defaultValue=""
                />
            </label>
        </div>
    );
}

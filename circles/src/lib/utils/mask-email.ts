// For log lines only: keeps the first character and the domain ("j***@gmail.com"), enough to spot
// patterns without writing anyone's address to the PM2 logs.
export const maskEmail = (email: unknown): string => {
    if (typeof email !== "string" || !email.trim()) {
        return "<no email>";
    }
    const trimmed = email.trim();
    const at = trimmed.lastIndexOf("@");
    if (at <= 0 || at === trimmed.length - 1) {
        return "<redacted>";
    }
    return `${trimmed.slice(0, 1)}***@${trimmed.slice(at + 1).toLowerCase()}`;
};

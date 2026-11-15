// The currencies an event's ticket price can be set in (event form). ZAR added 2026-11-15 (Tim): the
// first house concert's guests are in South Africa. Every code here is also in
// PEERIFY_CURRENCY_OPTIONS (booking settings, pledges), so a host's booking currency can prefill it.

export const EVENT_CURRENCY_OPTIONS = ["EUR", "USD", "GBP", "SEK", "ZAR"];

// A new event's currency from the host's booking currency, when it's one of the event currencies.
export const defaultEventCurrency = (circleCurrency: string | undefined | null): string | undefined =>
    circleCurrency && EVENT_CURRENCY_OPTIONS.includes(circleCurrency) ? circleCurrency : undefined;

// ISO 3166-1 alpha-2 country code -> ISO 4217 currency code. Used to suggest a default pledge
// currency from the fan's location (see pledge-dialog.tsx) — deliberately just a lookup table,
// no conversion/exchange-rate logic (explicitly out of scope; see item 3 in the task that added
// this). Covers the Eurozone plus every country whose currency appears in
// PEERIFY_CURRENCY_OPTIONS (artist-profile.ts) so a derived default is always a valid dropdown
// option; not an exhaustive ISO 3166 list.
const COUNTRY_CODE_TO_CURRENCY: Record<string, string> = {
    // Eurozone
    AT: "EUR",
    BE: "EUR",
    CY: "EUR",
    DE: "EUR",
    EE: "EUR",
    ES: "EUR",
    FI: "EUR",
    FR: "EUR",
    GR: "EUR",
    HR: "EUR",
    IE: "EUR",
    IT: "EUR",
    LT: "EUR",
    LU: "EUR",
    LV: "EUR",
    MT: "EUR",
    NL: "EUR",
    PT: "EUR",
    SI: "EUR",
    SK: "EUR",
    // USD
    US: "USD",
    // GBP
    GB: "GBP",
    // ZAR
    ZA: "ZAR",
    // SEK
    SE: "SEK",
    // NOK
    NO: "NOK",
    // DKK
    DK: "DKK",
    // CHF
    CH: "CHF",
    LI: "CHF",
    // CAD
    CA: "CAD",
    // AUD
    AU: "AUD",
    // NGN
    NG: "NGN",
    // KES
    KE: "KES",
    // BRL
    BR: "BRL",
    // JPY
    JP: "JPY",
    // INR
    IN: "INR",
    // MXN
    MX: "MXN",
};

export const getCurrencyForCountryCode = (countryCode?: string): string | undefined => {
    if (!countryCode) {
        return undefined;
    }

    return COUNTRY_CODE_TO_CURRENCY[countryCode.toUpperCase()];
};

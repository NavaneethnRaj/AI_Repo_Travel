const regions: Record<string, string> = {
  AU: "AUD", CA: "CAD", CH: "CHF", CN: "CNY", DE: "EUR", ES: "EUR", FR: "EUR",
  GB: "GBP", IN: "INR", IT: "EUR", JP: "JPY", NZ: "NZD", US: "USD",
};

export function suggestedCurrency(locale: string) {
  try {
    const region = new Intl.Locale(locale).region;
    return region ? regions[region] ?? "USD" : "USD";
  } catch {
    return "USD";
  }
}

export const currencies = [...new Set(Object.values(regions))].sort();

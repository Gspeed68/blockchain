import { ValuationProvider, ValuationQuery, ValuationResult } from "./types";

/**
 * Deterministic fake provider for local development and tests, so the
 * refresh-value flow (and its on-chain write) can be exercised without
 * calling either external API. Set VALUATION_PROVIDER=mock.
 */
export const mockProvider: ValuationProvider = {
  name: "mock",

  async fetchValuation(query: ValuationQuery): Promise<ValuationResult | null> {
    // A small, deterministic-per-bottle-name "random" walk so repeated
    // calls in a demo don't return the exact same number every time, but a
    // test asserting against a specific bottle name gets a stable value.
    let hash = 0;
    for (const ch of `${query.distillery}:${query.bottleName}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const base = 3000 + (hash % 15000); // $30.00 - $180.00
    return {
      valueCents: base,
      source: "mock",
      note: "Deterministic mock valuation for local development (VALUATION_PROVIDER=mock) — not a real market value.",
    };
  },
};

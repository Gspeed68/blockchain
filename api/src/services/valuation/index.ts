import { env } from "../../config/env";
import { logger } from "../../logger";
import { whiskyHunterProvider } from "./whiskyHunterProvider";
import { ebayBrowseProvider } from "./ebayBrowseProvider";
import { mockProvider } from "./mockProvider";
import { ValuationProvider, ValuationQuery, ValuationResult } from "./types";

export type { ValuationQuery, ValuationResult, ValuationProvider } from "./types";

const providersByName: Record<string, ValuationProvider> = {
  whiskyhunter: whiskyHunterProvider,
  ebay: ebayBrowseProvider,
  mock: mockProvider,
};

/**
 * Primary + fallback chain, controlled by VALUATION_PROVIDER (default
 * "whiskyhunter"). If the configured primary finds nothing (no auction
 * comps, or the API call itself fails) and it's not already the fallback,
 * eBay's active-listing search is tried next. `mock` never falls through
 * to anything else — it's for local dev, not a real fallback chain.
 */
export async function fetchEstimatedValue(query: ValuationQuery): Promise<ValuationResult | null> {
  const primary = providersByName[env.VALUATION_PROVIDER];

  try {
    const result = await primary.fetchValuation(query);
    if (result) return result;
  } catch (err) {
    logger.warn({ err, provider: primary.name, query }, "valuation:primary-provider-failed");
  }

  if (primary.name === "mock" || primary.name === "ebay-browse") return null;

  logger.info({ query }, "valuation:falling-back-to-ebay");
  try {
    return await ebayBrowseProvider.fetchValuation(query);
  } catch (err) {
    logger.warn({ err, query }, "valuation:fallback-provider-failed");
    return null;
  }
}

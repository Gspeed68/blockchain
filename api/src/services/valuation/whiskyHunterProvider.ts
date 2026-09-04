import { logger } from "../../logger";
import { ValuationProvider, ValuationQuery, ValuationResult } from "./types";

/**
 * Primary valuation source: WhiskyHunter (https://whiskyhunter.net/api/),
 * a free, no-API-key public API that aggregates completed auction results
 * from 28 whisky auction sites. Chosen over the alternatives researched for
 * this project because:
 *
 *  - It's free and requires no API key/approval process. eBay's
 *    Marketplace Insights API (actual *sold* listing data) is a "Limited
 *    Release" API that isn't open to new developers — so it's used here
 *    only as a fallback via the Browse API's *active listing* prices,
 *    which is a real but weaker signal (asking price, not a completed
 *    sale). See ebayBrowseProvider.ts.
 *  - It's a legitimate public API, not a scrape — no ToS to violate.
 *    (BAXUS was also considered; it has no published developer API.)
 *  - Its coverage skews Scotch/UK auction houses, so American bourbon hit
 *    rate will be lower than for Scotch — that's a real, known limitation,
 *    not an oversight. When it has no match, ebayBrowseProvider.ts is the
 *    fallback (see services/valuation/index.ts).
 *
 * IMPORTANT — verification status: this sandbox's network egress policy
 * blocks whiskyhunter.net directly, so this module was written from public
 * documentation/aggregator descriptions of the API rather than a live
 * response. The base URL, "no auth required", and "prices in GBP" facts
 * are corroborated by multiple independent sources; the exact field names
 * on each auction-lot record are NOT independently confirmed here, so
 * `extractLotPrice`/`extractLotName`/`extractLotDate` below check several
 * plausible field names defensively instead of assuming one. Before relying
 * on this in production: run it against the real API once network access
 * allows, fix the field names to match the real response, and replace this
 * comment with a dated Correction in README-BOURBON-PORT.md if anything
 * here was wrong (see that file for the pattern).
 */
const BASE_URL = "https://whiskyhunter.net/api";

// Static approximation — WhiskyHunter prices are GBP. A production version
// should pull a live rate (e.g. from a free FX API) instead; hardcoding one
// here keeps this POC's valuation path from depending on a THIRD external
// API just to convert currency. Override via env if the rate drifts badly.
const GBP_TO_USD = Number(process.env.GBP_TO_USD_RATE ?? "1.27");

interface DistilleryInfo {
  slug?: string;
  name?: string;
  distillery_name?: string;
}

export const whiskyHunterProvider: ValuationProvider = {
  name: "whiskyhunter",

  async fetchValuation(query: ValuationQuery): Promise<ValuationResult | null> {
    const slug = await findDistillerySlug(query.distillery);
    if (!slug) {
      logger.info({ distillery: query.distillery }, "whiskyhunter: no matching distillery");
      return null;
    }

    const res = await fetch(`${BASE_URL}/distillery_data/${encodeURIComponent(slug)}/?format=json`);
    if (!res.ok) {
      logger.warn({ status: res.status, slug }, "whiskyhunter: distillery_data request failed");
      return null;
    }
    const lots = (await res.json()) as unknown[];
    if (!Array.isArray(lots) || lots.length === 0) return null;

    const bottleNameLower = query.bottleName.toLowerCase();
    const matches = lots.filter((lot) => {
      const name = extractLotName(lot);
      return name && nameMatches(name.toLowerCase(), bottleNameLower);
    });

    const candidates = matches.length > 0 ? matches : lots; // fall back to whole-distillery comps if no exact name match
    const recent = sortByDateDesc(candidates).slice(0, 5);
    const pricesGbp = recent.map(extractLotPrice).filter((p): p is number => p !== null && p > 0);

    if (pricesGbp.length === 0) return null;

    const medianGbp = median(pricesGbp);
    const valueCents = Math.round(medianGbp * GBP_TO_USD * 100);

    return {
      valueCents,
      source: "whiskyhunter",
      note: `Median of ${pricesGbp.length} recent auction comp(s) for "${query.distillery}"${
        matches.length > 0 ? ` matching "${query.bottleName}"` : " (distillery-wide, no exact bottle-name match)"
      }, converted from GBP at ${GBP_TO_USD}.`,
    };
  },
};

async function findDistillerySlug(distilleryName: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/distilleries_info/?format=json`);
  if (!res.ok) {
    logger.warn({ status: res.status }, "whiskyhunter: distilleries_info request failed");
    return null;
  }
  const distilleries = (await res.json()) as DistilleryInfo[];
  const target = distilleryName.toLowerCase();

  const exact = distilleries.find((d) => (d.name ?? d.distillery_name ?? "").toLowerCase() === target);
  if (exact) return exact.slug ?? null;

  const partial = distilleries.find((d) => (d.name ?? d.distillery_name ?? "").toLowerCase().includes(target));
  return partial?.slug ?? null;
}

function nameMatches(candidate: string, target: string): boolean {
  return candidate.includes(target) || target.includes(candidate);
}

function extractLotName(lot: unknown): string | null {
  const obj = lot as Record<string, unknown>;
  const v = obj.lot_name ?? obj.title ?? obj.name ?? obj.description;
  return typeof v === "string" ? v : null;
}

function extractLotPrice(lot: unknown): number | null {
  const obj = lot as Record<string, unknown>;
  const v = obj.hammer_price ?? obj.price ?? obj.sold_price ?? obj.winning_bid;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractLotDate(lot: unknown): string | null {
  const obj = lot as Record<string, unknown>;
  const v = obj.sale_date ?? obj.date ?? obj.auction_date ?? obj.end_date;
  return typeof v === "string" ? v : null;
}

function sortByDateDesc(lots: unknown[]): unknown[] {
  return [...lots].sort((a, b) => {
    const da = extractLotDate(a);
    const db = extractLotDate(b);
    if (!da || !db) return 0;
    return new Date(db).getTime() - new Date(da).getTime();
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

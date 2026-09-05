import { logger } from "../../logger";
import { env } from "../../config/env";
import { ValuationProvider, ValuationQuery, ValuationResult } from "./types";

/**
 * Fallback valuation source, used when WhiskyHunter has no auction comps
 * for a bottle (common for smaller/newer American bourbon releases that
 * mostly trade outside the UK/EU auction houses WhiskyHunter aggregates).
 *
 * Deliberately NOT eBay's Marketplace Insights API (actual completed-sale
 * data) — that API is a "Limited Release" eBay restricts to
 * business-approved developers and states outright it isn't open to new
 * users. The Browse API (`item_summary/search`) is open to any registered
 * eBay developer app and free, but only returns ACTIVE listings — asking
 * prices, not confirmed sales. That's a meaningfully weaker signal, which
 * is exactly why this is the fallback and not the primary source; the
 * recorded appraisal's `note` says so explicitly so nobody mistakes an
 * asking-price median for a sale price down the line.
 *
 * Auth: OAuth2 client-credentials grant against eBay's Identity API using
 * an eBay Developer Program application's client id/secret (set
 * EBAY_CLIENT_ID / EBAY_CLIENT_SECRET — never commit these; see
 * api/.env.example). No user login involved — this is the
 * application-level token, scoped read-only to public browse data.
 */
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getApplicationToken(): Promise<string | null> {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    logger.info("ebay: EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not set, skipping");
    return null;
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const basicAuth = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "ebay: token request failed");
    return null;
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

export const ebayBrowseProvider: ValuationProvider = {
  name: "ebay-browse",

  async fetchValuation(query: ValuationQuery): Promise<ValuationResult | null> {
    const token = await getApplicationToken();
    if (!token) return null;

    const q = `${query.distillery} ${query.bottleName}`.trim();
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&limit=10`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!res.ok) {
      logger.warn({ status: res.status, q }, "ebay: search request failed");
      return null;
    }

    const json = (await res.json()) as {
      itemSummaries?: { price?: { value?: string; currency?: string }; title?: string }[];
    };
    const prices = (json.itemSummaries ?? [])
      .map((item) => (item.price?.currency === "USD" ? Number(item.price.value) : null))
      .filter((p): p is number => p !== null && Number.isFinite(p) && p > 0);

    if (prices.length === 0) {
      logger.info({ q }, "ebay: no USD active listings found");
      return null;
    }

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const valueCents = Math.round(avg * 100);

    return {
      valueCents,
      source: "ebay-browse",
      note: `Average ASKING price across ${prices.length} active eBay listing(s) for "${q}" — active listings, not confirmed sales (eBay's sold-listings API is not open to new developers; see services/valuation/ebayBrowseProvider.ts).`,
    };
  },
};

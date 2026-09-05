export interface ValuationQuery {
  distillery: string;
  bottleName: string;
  releaseYear?: number;
}

export interface ValuationResult {
  valueCents: number;
  source: string; // written on-chain as the Appraisal's `source` field
  note: string; // written on-chain as the Appraisal's `note` field
}

/**
 * Every valuation source implements this one interface, which is the whole
 * point of keeping this pluggable: bottleService/routes never know or care
 * whether a value came from WhiskyHunter, eBay, or a human typing a number
 * in — they just get back a ValuationResult (or null, meaning "no data
 * found, don't record anything").
 */
export interface ValuationProvider {
  readonly name: string;
  fetchValuation(query: ValuationQuery): Promise<ValuationResult | null>;
}

// Mirrors api/src/services/bottleService.ts's DTOs exactly — kept as a
// hand-written twin rather than a generated client so it's obvious at a
// glance what the frontend actually depends on (see api/API.md for the
// canonical shapes with real example responses).
export type Condition = "Sealed" | "OpenPourable" | "LowFill" | "Empty" | "Damaged";

export interface Bottle {
  id: number;
  owner: string;
  distillery: string;
  bottleName: string;
  proof: number;
  releaseYear: number;
  purchaseDate: string;
  purchasePriceCents: number;
  purchasePriceUsd: string;
  condition: Condition;
  fillLevelPercent: number;
  photoUri: string;
  photoHash: string;
  createdAt: string;
}

export interface Appraisal {
  id: number;
  bottleId: number;
  valueCents: number;
  valueUsd: string;
  timestamp: string;
  source: string;
  note: string;
  recordedBy: string;
}

export interface BottleDetail extends Bottle {
  appraisals: Appraisal[];
}

export interface NewBottleInput {
  distillery: string;
  bottleName: string;
  proof: number;
  releaseYear: number;
  purchaseDate: string;
  purchasePriceCents: number;
  condition: Condition;
  fillLevelPercent: number;
  photoUri: string;
  photoHash?: string;
}

export type WriteResult<T> =
  | { status: "confirmed"; transaction: { txHash: string; blockNumber: number; gasUsed: string }; data: T }
  | { status: "pending"; txHash: string; message: string };

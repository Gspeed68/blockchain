// Mirrors contracts/BottleRegistry.sol's enum ordering exactly — Solidity
// enums are just uint8s on the wire, so the order here has to match the
// order there or bottles will silently report the wrong condition.
export const CONDITIONS = ["Sealed", "OpenPourable", "LowFill", "Empty", "Damaged"] as const;
export type ConditionName = (typeof CONDITIONS)[number];

export interface OnChainBottle {
  id: bigint;
  owner: string;
  distillery: string;
  bottleName: string;
  proof: bigint;
  releaseYear: bigint;
  purchaseDate: bigint;
  purchasePriceCents: bigint;
  condition: bigint;
  fillLevelBps: bigint;
  photoURI: string;
  photoHash: string;
  createdAt: bigint;
  exists: boolean;
}

export interface OnChainAppraisal {
  id: bigint;
  bottleId: bigint;
  valueCents: bigint;
  timestamp: bigint;
  source: string;
  note: string;
  recordedBy: string;
}

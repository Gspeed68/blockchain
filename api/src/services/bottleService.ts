import { callView } from "../chain/readContract";
import { sendContractWrite } from "../chain/writeTransaction";
import { decodeEvent } from "../chain/events";
import { CONDITIONS, ConditionName, OnChainAppraisal, OnChainBottle } from "../chain/types";

/**
 * What every write endpoint in this API returns: either the freshly
 * confirmed resource (read back from the chain after the receipt lands —
 * see chain/writeTransaction.ts step 7/8) plus the tx metadata, or just a
 * txHash if it's still pending after the wait window (see routes/bottles.ts
 * for how that becomes a 202 response the frontend can poll on).
 */
export type WriteOutcome<T> =
  | { status: "confirmed"; txHash: string; blockNumber: number; gasUsed: string; data: T }
  | { status: "pending"; txHash: string };

export interface BottleDto {
  id: number;
  owner: string;
  distillery: string;
  bottleName: string;
  proof: number;
  releaseYear: number;
  purchaseDate: string;
  purchasePriceCents: number;
  purchasePriceUsd: string;
  condition: ConditionName;
  fillLevelPercent: number;
  photoUri: string;
  photoHash: string;
  createdAt: string;
}

export interface AppraisalDto {
  id: number;
  bottleId: number;
  valueCents: number;
  valueUsd: string;
  timestamp: string;
  source: string;
  note: string;
  recordedBy: string;
}

export interface NewBottleInput {
  distillery: string;
  bottleName: string;
  proof: number; // e.g. 100.6
  releaseYear: number;
  purchaseDate: string; // ISO date
  purchasePriceCents: number;
  condition: ConditionName;
  fillLevelPercent: number; // 0-100
  photoUri: string;
  photoHash?: string; // 0x-prefixed 32-byte hex; defaults to zero hash
}

const ZERO_HASH = "0x" + "0".repeat(64);

function centsToUsd(cents: bigint | number): string {
  const n = typeof cents === "bigint" ? cents : BigInt(Math.round(cents));
  const dollars = n / 100n;
  const remainder = (n % 100n).toString().padStart(2, "0");
  return `${dollars}.${remainder}`;
}

function toBottleDto(onChain: OnChainBottle): BottleDto {
  return {
    id: Number(onChain.id),
    owner: onChain.owner,
    distillery: onChain.distillery,
    bottleName: onChain.bottleName,
    proof: Number(onChain.proof) / 10,
    releaseYear: Number(onChain.releaseYear),
    purchaseDate: new Date(Number(onChain.purchaseDate) * 1000).toISOString(),
    purchasePriceCents: Number(onChain.purchasePriceCents),
    purchasePriceUsd: centsToUsd(onChain.purchasePriceCents),
    condition: CONDITIONS[Number(onChain.condition)],
    fillLevelPercent: Number(onChain.fillLevelBps) / 100,
    photoUri: onChain.photoURI,
    photoHash: onChain.photoHash,
    createdAt: new Date(Number(onChain.createdAt) * 1000).toISOString(),
  };
}

function toAppraisalDto(onChain: OnChainAppraisal): AppraisalDto {
  return {
    id: Number(onChain.id),
    bottleId: Number(onChain.bottleId),
    valueCents: Number(onChain.valueCents),
    valueUsd: centsToUsd(onChain.valueCents),
    timestamp: new Date(Number(onChain.timestamp) * 1000).toISOString(),
    source: onChain.source,
    note: onChain.note,
    recordedBy: onChain.recordedBy,
  };
}

/**
 * Every read below hits the chain directly (via callView -> eth_call) —
 * there is no bottles table anywhere in this API. For a personal
 * collection (tens, maybe low hundreds of bottles) an O(n) fan-out of
 * `eth_call`s per list request is genuinely fine and keeps the "is this
 * data actually current" question trivially answerable (yes, always — it
 * was read from the contract this request). A collection large enough for
 * that fan-out to matter would be a good reason to add a denormalized,
 * explicitly-a-cache read model with event-log-driven invalidation; that's
 * a deliberate future improvement, not an oversight.
 */
export async function listBottles(): Promise<BottleDto[]> {
  const [ids] = await callView<[bigint[]]>("getAllBottleIds");
  const bottles = await Promise.all(ids.map((id) => getBottle(Number(id))));
  return bottles;
}

export async function getBottle(id: number): Promise<BottleDto> {
  const [onChain] = await callView<[OnChainBottle]>("getBottle", [id]);
  return toBottleDto(onChain);
}

export async function listAppraisals(bottleId: number): Promise<AppraisalDto[]> {
  const [onChainList] = await callView<[OnChainAppraisal[]]>("getAppraisals", [bottleId]);
  return onChainList.map(toAppraisalDto);
}

export async function addBottle(input: NewBottleInput): Promise<WriteOutcome<BottleDto>> {
  const conditionIndex = CONDITIONS.indexOf(input.condition);
  const purchaseDateUnix = Math.floor(new Date(input.purchaseDate).getTime() / 1000);

  const write = await sendContractWrite("addBottle", [
    input.distillery,
    input.bottleName,
    Math.round(input.proof * 10),
    input.releaseYear,
    purchaseDateUnix,
    input.purchasePriceCents,
    conditionIndex,
    Math.round(input.fillLevelPercent * 100),
    input.photoUri,
    input.photoHash ?? ZERO_HASH,
  ]);

  if (write.status === "pending") return write;

  // The new bottle's id was assigned on-chain (nextBottleId++) — recover it
  // from the BottleAdded event this same transaction emitted rather than
  // guessing. See chain/events.ts for why.
  const event = decodeEvent(write.logs, "BottleAdded");
  if (!event) {
    throw new Error(`addBottle transaction ${write.txHash} confirmed but emitted no BottleAdded event`);
  }
  const bottleId = Number(event.args.bottleId as bigint);
  const data = await getBottle(bottleId);

  return { status: "confirmed", txHash: write.txHash, blockNumber: write.blockNumber, gasUsed: write.gasUsed, data };
}

export async function updateCondition(
  bottleId: number,
  condition: ConditionName,
  fillLevelPercent: number
): Promise<WriteOutcome<BottleDto>> {
  const conditionIndex = CONDITIONS.indexOf(condition);
  const write = await sendContractWrite("updateCondition", [bottleId, conditionIndex, Math.round(fillLevelPercent * 100)]);

  if (write.status === "pending") return write;
  const data = await getBottle(bottleId);
  return { status: "confirmed", txHash: write.txHash, blockNumber: write.blockNumber, gasUsed: write.gasUsed, data };
}

export async function recordAppraisal(
  bottleId: number,
  valueCents: number,
  source: string,
  note: string
): Promise<WriteOutcome<AppraisalDto>> {
  const write = await sendContractWrite("recordAppraisal", [bottleId, valueCents, source, note]);

  if (write.status === "pending") return write;
  // recordAppraisal only ever appends, so the entry this transaction just
  // created is always the latest one for this bottle.
  const [onChain] = await callView<[OnChainAppraisal]>("getLatestAppraisal", [bottleId]);
  const data = toAppraisalDto(onChain);
  return { status: "confirmed", txHash: write.txHash, blockNumber: write.blockNumber, gasUsed: write.gasUsed, data };
}

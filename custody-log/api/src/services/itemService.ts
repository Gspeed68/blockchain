import { callView } from "../chain/readContract";
import { sendContractWrite } from "../chain/writeTransaction";
import { decodeEvent } from "../chain/events";
import { EVENT_TYPES, EventTypeName, ITEM_STATUSES, ItemStatusName, OnChainCustodyEvent, OnChainItem } from "../chain/types";

/**
 * What every write endpoint in this API returns: either the freshly
 * confirmed resource (read back from the chain after the receipt lands —
 * see chain/writeTransaction.ts step 7/8) plus the tx metadata, or just a
 * txHash if it's still pending after the wait window (see routes/items.ts
 * for how that becomes a 202 response the frontend can poll on).
 */
export type WriteOutcome<T> =
  | { status: "confirmed"; txHash: string; blockNumber: number; gasUsed: string; data: T }
  | { status: "pending"; txHash: string };

export interface ItemDto {
  id: number;
  registeredBy: string;
  sku: string;
  description: string;
  category: string;
  originLocation: string;
  status: ItemStatusName;
  currentCustodian: string;
  currentLocation: string;
  createdAt: string;
}

export interface CustodyEventDto {
  id: number;
  itemId: number;
  eventType: EventTypeName;
  fromCustodian: string;
  toCustodian: string;
  location: string;
  notes: string;
  documentUri: string;
  documentHash: string;
  timestamp: string;
  recordedBy: string;
}

export interface NewItemInput {
  sku: string;
  description: string;
  category: string;
  originLocation: string;
  initialCustodian: string;
  documentUri?: string;
  documentHash?: string;
}

export interface NewCustodyEventInput {
  eventType: Exclude<EventTypeName, "Registered">;
  toCustodian: string;
  location: string;
  notes?: string;
  documentUri?: string;
  documentHash?: string;
}

const ZERO_HASH = "0x" + "0".repeat(64);

function toItemDto(onChain: OnChainItem): ItemDto {
  return {
    id: Number(onChain.id),
    registeredBy: onChain.registeredBy,
    sku: onChain.sku,
    description: onChain.description,
    category: onChain.category,
    originLocation: onChain.originLocation,
    status: ITEM_STATUSES[Number(onChain.status)],
    currentCustodian: onChain.currentCustodian,
    currentLocation: onChain.currentLocation,
    createdAt: new Date(Number(onChain.createdAt) * 1000).toISOString(),
  };
}

function toCustodyEventDto(onChain: OnChainCustodyEvent): CustodyEventDto {
  return {
    id: Number(onChain.id),
    itemId: Number(onChain.itemId),
    eventType: EVENT_TYPES[Number(onChain.eventType)],
    fromCustodian: onChain.fromCustodian,
    toCustodian: onChain.toCustodian,
    location: onChain.location,
    notes: onChain.notes,
    documentUri: onChain.documentURI,
    documentHash: onChain.documentHash,
    timestamp: new Date(Number(onChain.timestamp) * 1000).toISOString(),
    recordedBy: onChain.recordedBy,
  };
}

/**
 * Every read below hits the chain directly (via callView -> eth_call) —
 * there is no items table anywhere in this API. See bottleService.ts in
 * the sibling bourbon-registry project for the fuller rationale (same
 * argument applies here: an O(n) fan-out of `eth_call`s per list request
 * is fine at this scale, and keeps "is this current" trivially answerable).
 */
export async function listItems(): Promise<ItemDto[]> {
  const [ids] = await callView<[bigint[]]>("getAllItemIds");
  return Promise.all(ids.map((id) => getItem(Number(id))));
}

export async function getItem(id: number): Promise<ItemDto> {
  const [onChain] = await callView<[OnChainItem]>("getItem", [id]);
  return toItemDto(onChain);
}

export async function listCustodyEvents(itemId: number): Promise<CustodyEventDto[]> {
  const [onChainList] = await callView<[OnChainCustodyEvent[]]>("getCustodyEvents", [itemId]);
  return onChainList.map(toCustodyEventDto);
}

export async function registerItem(input: NewItemInput): Promise<WriteOutcome<ItemDto>> {
  const write = await sendContractWrite("registerItem", [
    input.sku,
    input.description,
    input.category,
    input.originLocation,
    input.initialCustodian,
    input.documentUri ?? "",
    input.documentHash ?? ZERO_HASH,
  ]);

  if (write.status === "pending") return write;

  // The new item's id was assigned on-chain (nextItemId++) — recover it
  // from the ItemRegistered event this same transaction emitted rather
  // than guessing. See chain/events.ts for why.
  const event = decodeEvent(write.logs, "ItemRegistered");
  if (!event) {
    throw new Error(`registerItem transaction ${write.txHash} confirmed but emitted no ItemRegistered event`);
  }
  const itemId = Number(event.args.itemId as bigint);
  const data = await getItem(itemId);

  return { status: "confirmed", txHash: write.txHash, blockNumber: write.blockNumber, gasUsed: write.gasUsed, data };
}

export async function recordCustodyEvent(
  itemId: number,
  input: NewCustodyEventInput
): Promise<WriteOutcome<CustodyEventDto>> {
  const eventTypeIndex = EVENT_TYPES.indexOf(input.eventType);
  const write = await sendContractWrite("recordCustodyEvent", [
    itemId,
    eventTypeIndex,
    input.toCustodian,
    input.location,
    input.notes ?? "",
    input.documentUri ?? "",
    input.documentHash ?? ZERO_HASH,
  ]);

  if (write.status === "pending") return write;
  // recordCustodyEvent only ever appends, so the entry this transaction
  // just created is always the latest one for this item.
  const [onChain] = await callView<[OnChainCustodyEvent]>("getLatestCustodyEvent", [itemId]);
  const data = toCustodyEventDto(onChain);
  return { status: "confirmed", txHash: write.txHash, blockNumber: write.blockNumber, gasUsed: write.gasUsed, data };
}

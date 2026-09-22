// Mirrors api/src/services/itemService.ts's DTOs exactly — kept as a
// hand-written twin rather than a generated client so it's obvious at a
// glance what the frontend actually depends on.
export type ItemStatus = "Registered" | "InTransit" | "AtCustodian" | "Delivered" | "Damaged" | "Lost";
export type EventType = "Registered" | "Transferred" | "Inspected" | "Delivered" | "Damaged" | "Lost";
export type RecordableEventType = Exclude<EventType, "Registered">;

export interface Item {
  id: number;
  registeredBy: string;
  sku: string;
  description: string;
  category: string;
  originLocation: string;
  status: ItemStatus;
  currentCustodian: string;
  currentLocation: string;
  createdAt: string;
}

export interface CustodyEvent {
  id: number;
  itemId: number;
  eventType: EventType;
  fromCustodian: string;
  toCustodian: string;
  location: string;
  notes: string;
  documentUri: string;
  documentHash: string;
  timestamp: string;
  recordedBy: string;
}

export interface ItemDetail extends Item {
  custodyEvents: CustodyEvent[];
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
  eventType: RecordableEventType;
  toCustodian: string;
  location: string;
  notes?: string;
  documentUri?: string;
  documentHash?: string;
}

export type WriteResult<T> =
  | { status: "confirmed"; transaction: { txHash: string; blockNumber: number; gasUsed: string }; data: T }
  | { status: "pending"; txHash: string; message: string };

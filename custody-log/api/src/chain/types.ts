// Mirrors contracts/CustodyRegistry.sol's enum ordering exactly — Solidity
// enums are just uint8s on the wire, so the order here has to match the
// order there or items/events will silently report the wrong status/type.
export const ITEM_STATUSES = ["Registered", "InTransit", "AtCustodian", "Delivered", "Damaged", "Lost"] as const;
export type ItemStatusName = (typeof ITEM_STATUSES)[number];

export const EVENT_TYPES = ["Registered", "Transferred", "Inspected", "Delivered", "Damaged", "Lost"] as const;
export type EventTypeName = (typeof EVENT_TYPES)[number];

export interface OnChainItem {
  id: bigint;
  registeredBy: string;
  sku: string;
  description: string;
  category: string;
  originLocation: string;
  status: bigint;
  currentCustodian: string;
  currentLocation: string;
  createdAt: bigint;
  exists: boolean;
}

export interface OnChainCustodyEvent {
  id: bigint;
  itemId: bigint;
  eventType: bigint;
  fromCustodian: string;
  toCustodian: string;
  location: string;
  notes: string;
  documentURI: string;
  documentHash: string;
  timestamp: bigint;
  recordedBy: string;
}

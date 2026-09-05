import { LogDescription } from "ethers";
import { contractInterface } from "./contract";
import { TransactionLog } from "./writeTransaction";

/**
 * Decodes a specific event out of a transaction receipt's logs.
 *
 * Why this exists: `addBottle` assigns the new bottle's id on-chain
 * (`nextBottleId++`) — the caller doesn't choose it and can't know it in
 * advance. The receipt only tells us the transaction succeeded, not what id
 * got assigned. The contract emits `BottleAdded(bottleId, owner, ...)`
 * specifically so callers can recover that id from the receipt's logs
 * instead of guessing (e.g. "read the collection and assume the highest id
 * is mine", which breaks the moment there's more than one writer). This is
 * the standard pattern for "what did this write actually create" — read it
 * back from the event, not from a side-channel assumption.
 */
export function decodeEvent(logs: TransactionLog[], eventName: string): LogDescription | null {
  for (const log of logs) {
    try {
      const parsed = contractInterface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === eventName) return parsed;
    } catch {
      // Not one of our events (or not decodable with our ABI) — logs from
      // other contracts/topics show up here too on a shared chain, so
      // this is an expected, non-error case, not a warning.
    }
  }
  return null;
}

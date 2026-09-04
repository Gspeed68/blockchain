import { RpcError } from "./rpcClient";
import { contractInterface } from "./contract";

/**
 * Decodes a revert into a human-readable string. Shared by readContract.ts
 * (an `eth_call` that reverts) and writeTransaction.ts (an `eth_estimateGas`
 * that reverts before we ever send anything, and the post-hoc `eth_call`
 * replay used to explain a transaction that reverted after being mined —
 * see writeTransaction.ts for why that replay is necessary).
 */
export function decodeRevertReason(err: RpcError): string {
  const data = extractRevertData(err.rpcData);
  if (!data) return err.message;

  try {
    const parsed = contractInterface.parseError(data);
    if (parsed) {
      const args = parsed.args.map(String).join(", ");
      return `${parsed.name}(${args})`;
    }
  } catch {
    // not one of our custom errors — fall through
  }

  // Plain `require(condition, "message")` reverts encode as Error(string).
  if (data.startsWith("0x08c379a0")) {
    try {
      const [reason] = contractInterface.decodeErrorResult("Error", data);
      return String(reason);
    } catch {
      // ignore, fall through
    }
  }

  return `${err.message} (undecoded revert data: ${data})`;
}

function extractRevertData(rpcData: unknown): string | undefined {
  if (typeof rpcData === "string" && rpcData.startsWith("0x")) return rpcData;
  if (rpcData && typeof rpcData === "object" && "data" in rpcData) {
    const inner = (rpcData as { data?: unknown }).data;
    if (typeof inner === "string" && inner.startsWith("0x")) return inner;
  }
  return undefined;
}

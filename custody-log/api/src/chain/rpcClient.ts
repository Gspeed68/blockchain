import { logger } from "../logger";

/**
 * A deliberately thin, hand-written JSON-RPC client. There's no ethers
 * `Provider` here on purpose — this project's whole point is to make the
 * request/response shape of talking to an Ethereum-family node visible
 * instead of hiding it behind a library abstraction. Every JSON-RPC call
 * the API makes goes through `rpcCall`, so it's the one place to look if
 * you want to see exactly what's going over the wire.
 */

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number | undefined,
    public readonly rpcData: unknown
  ) {
    super(message);
    this.name = "RpcError";
  }
}

let idCounter = 0;

export async function rpcCall<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const id = ++idCounter;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

  logger.debug({ endpoint, method, params }, "rpc:request");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    throw new RpcError(`HTTP ${res.status} calling ${method} at ${endpoint}`, res.status, await res.text());
  }

  const json = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };

  if (json.error) {
    // A JSON-RPC "error" here is how a REVERTED `eth_call` / `eth_estimateGas`
    // surfaces — not just transport failures. Callers that care about
    // reverts specifically (readContract.ts, writeTransaction.ts) inspect
    // this error rather than treating every RpcError the same way.
    logger.debug({ endpoint, method, error: json.error }, "rpc:error-response");
    throw new RpcError(json.error.message, json.error.code, json.error.data);
  }

  logger.debug({ endpoint, method, result: json.result }, "rpc:response");
  return json.result as T;
}

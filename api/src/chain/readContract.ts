import { rpcCall, RpcError } from "./rpcClient";
import { contractInterface, CONTRACT_ADDRESS } from "./contract";
import { decodeRevertReason } from "./revert";
import { env } from "../config/env";

export class ContractCallRevertedError extends Error {
  constructor(
    public readonly functionName: string,
    public readonly decodedReason: string
  ) {
    super(`${functionName} reverted: ${decodedReason}`);
    this.name = "ContractCallRevertedError";
  }
}

/**
 * A read-only contract call. This is `eth_call` — it never touches the
 * mempool, never costs gas, and never changes state; the node just runs the
 * EVM against its current (or a historical) state and returns the result.
 * Every GET endpoint in this API resolves to one or more of these, which is
 * what keeps API responses honest instead of drifting from a local cache:
 * there is no local copy of bottle/appraisal data to go stale.
 */
export async function callView<T extends unknown[] = unknown[]>(
  functionName: string,
  args: unknown[] = [],
  blockTag: string = "latest"
): Promise<T> {
  const data = contractInterface.encodeFunctionData(functionName, args);

  try {
    const resultHex = await rpcCall<string>(env.BESU_RPC_URL, "eth_call", [
      { to: CONTRACT_ADDRESS, data },
      blockTag,
    ]);
    const decoded = contractInterface.decodeFunctionResult(functionName, resultHex);
    return decoded as unknown as T;
  } catch (err) {
    if (err instanceof RpcError) {
      throw new ContractCallRevertedError(functionName, decodeRevertReason(err));
    }
    throw err;
  }
}

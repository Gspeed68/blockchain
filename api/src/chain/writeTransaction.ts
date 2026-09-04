import { rpcCall, RpcError } from "./rpcClient";
import { contractInterface, CONTRACT_ADDRESS } from "./contract";
import { decodeRevertReason } from "./revert";
import { callView } from "./readContract";
import { env } from "../config/env";
import { logger } from "../logger";

export class TransactionWouldRevertError extends Error {
  constructor(
    public readonly functionName: string,
    public readonly decodedReason: string
  ) {
    super(`${functionName} would revert if sent: ${decodedReason}`);
    this.name = "TransactionWouldRevertError";
  }
}

export class TransactionRevertedError extends Error {
  constructor(
    public readonly txHash: string,
    public readonly decodedReason: string
  ) {
    super(`Transaction ${txHash} was mined but reverted: ${decodedReason}`);
    this.name = "TransactionRevertedError";
  }
}

export interface TransactionLog {
  address: string;
  topics: string[];
  data: string;
}

export interface ConfirmedWrite {
  status: "confirmed";
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  logs: TransactionLog[];
}

export interface PendingWrite {
  status: "pending";
  txHash: string;
}

/**
 * The signer address Web3Signer manages for this app. It's the same
 * address every time (one KMS key, see README-BOURBON-PORT.md), so we
 * fetch it once via `eth_accounts` and cache it rather than asking on every
 * write. `eth_accounts` against Web3Signer (NOT Besu — Besu itself holds
 * no keys and would just return an empty array) is how Web3Signer tells a
 * client which addresses it's willing to sign for.
 */
let cachedSignerAddress: string | undefined;

async function getSignerAddress(): Promise<string> {
  if (cachedSignerAddress) return cachedSignerAddress;
  const accounts = await rpcCall<string[]>(env.WEB3SIGNER_RPC_URL, "eth_accounts", []);
  if (accounts.length === 0) {
    throw new Error(
      "Web3Signer returned no accounts. Check docker/web3signer/keys/eth1-app-identity.yaml is present " +
        "and Web3Signer's logs for an AWS KMS auth error (IMDS role, key ARN, region)."
    );
  }
  cachedSignerAddress = accounts[0];
  return cachedSignerAddress;
}

/**
 * Sends a state-changing contract call end to end and (by default) waits
 * for it to be mined. This function is the one place in the whole app that
 * does the "how does a backend actually talk to a blockchain" thing the
 * project exists to make visible — every step below is deliberately not
 * hidden behind `ethers.Contract.someMethod()` or `provider.sendTransaction()`.
 *
 * The steps, in order:
 *
 *  1. Resolve the signer address (the KMS-backed identity Web3Signer holds).
 *  2. ABI-encode the call.
 *  3. `eth_estimateGas` FIRST, against the same node that will execute the
 *     real transaction. This is a dry run: if the call would revert (e.g.
 *     a non-admin caller, or an unknown bottle id), the estimate call
 *     itself reverts and we find out *before* spending a nonce or any gas
 *     on a transaction that was always going to fail. Skipping this step
 *     is the single most common way to burn gas for nothing.
 *  4. `eth_getTransactionCount(address, "pending")` for the nonce — "pending"
 *     (not "latest") counts transactions still sitting in the mempool, so
 *     firing off several writes back-to-back doesn't reuse a nonce and
 *     have the second one silently queue behind (or replace) the first.
 *  5. `eth_gasPrice` for the current price. This network runs pre-London
 *     (no EIP-1559 base fee — see QBFT-Network/config/qbftConfigFile.json),
 *     so it's a single legacy `gasPrice` field, not `maxFeePerGas`/
 *     `maxPriorityFeePerGas`.
 *  6. Send the fully-formed transaction to *Web3Signer's* `eth_sendTransaction`
 *     — not Besu's. Web3Signer recognizes `from` as its KMS-backed address,
 *     signs the transaction with that key (the private key never leaves
 *     AWS KMS — Web3Signer sends KMS the transaction hash and gets back a
 *     signature), and forwards the signed raw transaction to Besu itself.
 *     The call returns a transaction hash immediately — that's the
 *     "pending" state: the node has accepted it into its mempool, but no
 *     block has included it yet.
 *  7. Poll `eth_getTransactionReceipt` until it stops returning `null`
 *     (mined) or we give up (still pending — see PendingWrite). A receipt
 *     existing does NOT mean the transaction succeeded: check `status`.
 *  8. `status: "0x1"` = succeeded. `status: "0x0"` = reverted — the
 *     transaction was still mined (it consumed gas and incremented the
 *     nonce!) even though it failed. This can happen even after step 3's
 *     dry run if chain state changed between the estimate and the
 *     transaction's actual execution (another transaction landed first).
 *     When that happens we replay the exact same call as a plain
 *     `eth_call` against the block just before the failure, which gives us
 *     back a decodable revert reason even though the receipt alone
 *     wouldn't have one.
 */
export async function sendContractWrite(
  functionName: string,
  args: unknown[],
  options: { waitMs?: number; pollIntervalMs?: number } = {}
): Promise<ConfirmedWrite | PendingWrite> {
  const waitMs = options.waitMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;

  const from = await getSignerAddress();
  const data = contractInterface.encodeFunctionData(functionName, args);

  // Step 3: dry run before spending anything.
  let gasEstimateHex: string;
  try {
    gasEstimateHex = await rpcCall<string>(env.BESU_RPC_URL, "eth_estimateGas", [{ from, to: CONTRACT_ADDRESS, data }]);
  } catch (err) {
    if (err instanceof RpcError) {
      throw new TransactionWouldRevertError(functionName, decodeRevertReason(err));
    }
    throw err;
  }

  // Add a 20% safety margin. `eth_estimateGas` is only exact for the exact
  // state it ran against; by the time our transaction actually lands, an
  // intervening transaction can make the same call cost slightly more gas
  // (e.g. a storage slot that was already warm/non-zero for the estimate
  // is cold/zero when ours actually runs). Too little margin risks an
  // out-of-gas revert for a transaction that otherwise would have
  // succeeded; a 20% buffer only costs unused gas, which Besu refunds.
  const gasLimit = (BigInt(gasEstimateHex) * 120n) / 100n;

  // Step 4 + 5: nonce and gas price, fetched explicitly rather than left
  // for Web3Signer/Besu to fill in — see the function-level comment.
  const [nonceHex, gasPriceHex] = await Promise.all([
    rpcCall<string>(env.BESU_RPC_URL, "eth_getTransactionCount", [from, "pending"]),
    rpcCall<string>(env.BESU_RPC_URL, "eth_gasPrice", []),
  ]);

  const txParams = {
    from,
    to: CONTRACT_ADDRESS,
    data,
    gas: "0x" + gasLimit.toString(16),
    gasPrice: gasPriceHex,
    nonce: nonceHex,
  };

  logger.info({ functionName, txParams }, "chain:sending-transaction");

  // Step 6: Web3Signer, not Besu. This is the only network call in the
  // entire write path that touches the private key (indirectly — Web3Signer
  // calls AWS KMS's Sign API; the key material itself never leaves KMS).
  const txHash = await rpcCall<string>(env.WEB3SIGNER_RPC_URL, "eth_sendTransaction", [txParams]);
  logger.info({ functionName, txHash }, "chain:transaction-submitted-pending");

  // Step 7 + 8: poll for the receipt.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const receipt = await rpcCall<TransactionReceipt | null>(env.BESU_RPC_URL, "eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      return await interpretReceipt(functionName, args, receipt);
    }
    await sleep(pollIntervalMs);
  }

  logger.warn({ functionName, txHash }, "chain:still-pending-after-timeout");
  return { status: "pending", txHash };
}

interface TransactionReceipt {
  status: "0x0" | "0x1";
  blockNumber: string;
  gasUsed: string;
  transactionHash: string;
  logs: TransactionLog[];
}

async function interpretReceipt(
  functionName: string,
  args: unknown[],
  receipt: TransactionReceipt
): Promise<ConfirmedWrite> {
  if (receipt.status === "0x1") {
    return {
      status: "confirmed",
      txHash: receipt.transactionHash,
      blockNumber: parseInt(receipt.blockNumber, 16),
      gasUsed: BigInt(receipt.gasUsed).toString(),
      logs: receipt.logs,
    };
  }

  // Reverted-but-mined: recover a reason by replaying the same call as a
  // read-only `eth_call` against the state right before this transaction
  // landed (blockNumber - 1). The receipt itself carries no revert reason
  // (Besu doesn't include one in the receipt by default), but re-running
  // the identical call against the pre-transaction state reproduces the
  // same revert, and *that* comes back with decodable error data.
  const priorBlock = "0x" + (parseInt(receipt.blockNumber, 16) - 1).toString(16);
  let reason = "unknown (replay to recover reason also failed)";
  try {
    await callView(functionName, args, priorBlock);
    // If the replay didn't throw, the revert was state-dependent in a way
    // this simple replay can't reproduce (e.g. it depends on
    // `block.timestamp` at the exact mined block). Say so plainly instead
    // of pretending we know why.
    reason = "reverted on-chain, but replaying against the prior block succeeded — likely a block-context-dependent revert";
  } catch (err) {
    if (err instanceof Error && "decodedReason" in err) {
      reason = (err as { decodedReason: string }).decodedReason;
    }
  }

  throw new TransactionRevertedError(receipt.transactionHash, reason);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

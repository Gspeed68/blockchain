import fs from "node:fs";
import path from "node:path";
import { Interface } from "ethers";
import { env } from "../config/env";

interface ContractConfig {
  network: string;
  address: string;
  deployTxHash: string | null;
  abi: unknown[];
}

const configPath = path.resolve(process.cwd(), env.CONTRACT_CONFIG_PATH);
const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw) as ContractConfig;

if (config.address === "0x0000000000000000000000000000000000000000") {
  // Not fatal at boot — health checks and static routes should still work —
  // but every chain-touching call will fail with a clear message rather
  // than a confusing "call to the zero address" error from deep inside the
  // RPC client.
  // eslint-disable-next-line no-console
  console.warn(
    `WARNING: ${configPath} still has the placeholder zero address. ` +
      "Run `cd hardhat && npm run deploy:besu` (or deploy:local) and re-check this file."
  );
}

export const CONTRACT_ADDRESS = config.address;

/**
 * `ethers.Interface` is used ONLY for ABI encoding/decoding (turning
 * `addBottle(...)` + args into calldata, and turning returned bytes back
 * into typed values). It does not send anything over the network — that's
 * entirely rpcClient.ts + writeTransaction.ts/readContract.ts. Keeping
 * these separate is deliberate: ABI encoding is boring, well-solved, and
 * not worth hand-rolling; the RPC/transaction lifecycle is the part this
 * project exists to make visible, so that stays hand-written.
 */
export const contractInterface = new Interface(config.abi as never);

export function isContractDeployed(): boolean {
  return CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";
}

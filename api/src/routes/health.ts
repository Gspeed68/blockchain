import { Router } from "express";
import { rpcCall } from "../chain/rpcClient";
import { env } from "../config/env";
import { isContractDeployed, CONTRACT_ADDRESS } from "../chain/contract";
import { asyncHandler } from "../middleware/asyncHandler";

export const healthRouter = Router();

/**
 * A real connectivity check, not just "the process is alive" — it makes
 * one call to Besu and one to Web3Signer and reports both, which is a
 * genuinely useful thing to see explicitly ("is Besu up?" and "does
 * Web3Signer see the Key Vault key?" are two different failure modes with two
 * different fixes).
 */
healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const [besu, web3signer] = await Promise.allSettled([
      (async () => {
        const [chainIdHex, blockNumberHex] = await Promise.all([
          rpcCall<string>(env.BESU_RPC_URL, "eth_chainId", []),
          rpcCall<string>(env.BESU_RPC_URL, "eth_blockNumber", []),
        ]);
        return { chainId: parseInt(chainIdHex, 16), blockNumber: parseInt(blockNumberHex, 16) };
      })(),
      (async () => {
        const accounts = await rpcCall<string[]>(env.WEB3SIGNER_RPC_URL, "eth_accounts", []);
        return { accounts };
      })(),
    ]);

    const ok = besu.status === "fulfilled" && web3signer.status === "fulfilled";

    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      contract: { address: CONTRACT_ADDRESS, deployed: isContractDeployed() },
      besu: besu.status === "fulfilled" ? { ok: true, ...besu.value } : { ok: false, error: String(besu.reason) },
      web3signer:
        web3signer.status === "fulfilled"
          ? { ok: true, ...web3signer.value }
          : { ok: false, error: String(web3signer.reason) },
    });
  })
);

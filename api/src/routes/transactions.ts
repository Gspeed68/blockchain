import { Router } from "express";
import { rpcCall } from "../chain/rpcClient";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";

export const transactionsRouter = Router();

/**
 * Lets a client (the frontend, or `curl`) check on a transaction directly
 * instead of only ever finding out through a write endpoint's response —
 * useful when a write returned 202 (still pending after the wait window;
 * see chain/writeTransaction.ts) and the caller wants to poll until it
 * lands, and a good bare-bones illustration of "pending vs confirmed" on
 * its own: `eth_getTransactionByHash` returns a transaction with
 * `blockNumber: null` while it's only in the mempool, and a real block
 * number once mined; `eth_getTransactionReceipt` returns null until mined,
 * then carries the pass/fail `status`.
 */
transactionsRouter.get(
  "/transactions/:txHash",
  asyncHandler(async (req, res) => {
    const { txHash } = req.params;

    const [tx, receipt] = await Promise.all([
      rpcCall<{ blockNumber: string | null } | null>(env.BESU_RPC_URL, "eth_getTransactionByHash", [txHash]),
      rpcCall<{ status: "0x0" | "0x1"; blockNumber: string; gasUsed: string } | null>(
        env.BESU_RPC_URL,
        "eth_getTransactionReceipt",
        [txHash]
      ),
    ]);

    if (!tx) {
      res.status(404).json({ error: "not_found", message: "No transaction with that hash is known to this node." });
      return;
    }

    if (!receipt) {
      res.status(200).json({ txHash, status: "pending" });
      return;
    }

    res.status(200).json({
      txHash,
      status: receipt.status === "0x1" ? "confirmed" : "reverted",
      blockNumber: parseInt(receipt.blockNumber, 16),
      gasUsed: BigInt(receipt.gasUsed).toString(),
    });
  })
);

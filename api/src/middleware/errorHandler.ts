import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger";
import { ContractCallRevertedError } from "../chain/readContract";
import { TransactionRevertedError, TransactionWouldRevertError } from "../chain/writeTransaction";
import { RpcError } from "../chain/rpcClient";

/**
 * Maps the chain-layer errors (see chain/*.ts) to HTTP status codes that
 * actually mean something to an API client, instead of every failure
 * becoming an opaque 500. This is also the one place that decides how much
 * of a revert reason is safe/useful to hand back to a caller.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_request", details: err.issues });
    return;
  }

  if (err instanceof TransactionWouldRevertError) {
    // Caught at the eth_estimateGas dry-run stage — nothing was ever sent,
    // no gas was spent, no nonce was consumed.
    res.status(400).json({ error: "transaction_would_revert", reason: err.decodedReason });
    return;
  }

  if (err instanceof TransactionRevertedError) {
    // The transaction WAS mined and DID cost gas, even though it failed.
    res.status(409).json({
      error: "transaction_reverted",
      txHash: err.txHash,
      reason: err.decodedReason,
      note: "This transaction was mined (gas was spent) but reverted on-chain.",
    });
    return;
  }

  if (err instanceof ContractCallRevertedError) {
    res.status(err.decodedReason.startsWith("BottleNotFound") ? 404 : 400).json({
      error: "contract_call_reverted",
      function: err.functionName,
      reason: err.decodedReason,
    });
    return;
  }

  if (err instanceof RpcError) {
    logger.error({ err }, "rpc_unreachable_or_unexpected");
    res.status(502).json({ error: "chain_rpc_error", message: err.message });
    return;
  }

  logger.error({ err, path: req.path }, "unhandled_error");
  res.status(500).json({ error: "internal_error" });
}

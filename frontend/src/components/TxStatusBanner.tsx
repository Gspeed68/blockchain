import "./TxStatusBanner.css";

export type TxBannerState =
  | { kind: "submitting"; label: string }
  | { kind: "pending"; txHash: string }
  | { kind: "confirmed"; txHash: string; blockNumber: number }
  | { kind: "error"; message: string };

/**
 * Writing to a blockchain isn't instant — this makes that visible instead
 * of hiding it behind a spinner that could mean anything. "submitting"
 * covers the eth_estimateGas/nonce/eth_sendTransaction round trip;
 * "pending" means the API got a txHash back but the transaction hadn't
 * been mined within its wait window (still real progress, just needs more
 * time); "confirmed" is the receipt landing with a block number.
 */
export function TxStatusBanner({ state }: { state: TxBannerState }) {
  if (state.kind === "submitting") {
    return (
      <div className="tx-banner tx-banner--submitting">
        <span className="tx-banner__spinner" aria-hidden="true" />
        {state.label}
      </div>
    );
  }
  if (state.kind === "pending") {
    return (
      <div className="tx-banner tx-banner--pending">
        <span className="tx-banner__spinner" aria-hidden="true" />
        Transaction submitted, waiting for it to be mined…
        <code className="tx-banner__hash">{shortHash(state.txHash)}</code>
      </div>
    );
  }
  if (state.kind === "confirmed") {
    return (
      <div className="tx-banner tx-banner--confirmed">
        ✓ Confirmed in block {state.blockNumber}
        <code className="tx-banner__hash">{shortHash(state.txHash)}</code>
      </div>
    );
  }
  return <div className="tx-banner tx-banner--error">✕ {state.message}</div>;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

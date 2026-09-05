import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { LoadingView, ErrorView } from "../components/StateViews";
import { ConditionBadge } from "../components/ConditionBadge";
import { BottlePhoto } from "../components/BottlePhoto";
import { ValueChart } from "../components/ValueChart";
import { TxStatusBanner, TxBannerState } from "../components/TxStatusBanner";
import type { Condition, WriteResult } from "../api/types";
import "./BottleDetailPage.css";

const CONDITIONS: Condition[] = ["Sealed", "OpenPourable", "LowFill", "Empty", "Damaged"];

function handleWriteOutcome<T>(
  outcome: WriteResult<T>,
  setBanner: (b: TxBannerState) => void,
  onConfirmed: (data: T) => void
) {
  if (outcome.status === "confirmed") {
    setBanner({ kind: "confirmed", txHash: outcome.transaction.txHash, blockNumber: outcome.transaction.blockNumber });
    onConfirmed(outcome.data);
  } else {
    setBanner({ kind: "pending", txHash: outcome.txHash });
  }
}

export function BottleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const bottleId = Number(id);
  const navigate = useNavigate();

  const load = useCallback(() => api.getBottle(bottleId), [bottleId]);
  const state = useAsync(load, [bottleId]);

  const [banner, setBanner] = useState<TxBannerState | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [busy, setBusy] = useState(false);

  const withBanner = async (submittingLabel: string, run: () => Promise<void>) => {
    setBusy(true);
    setBanner({ kind: "submitting", label: submittingLabel });
    try {
      await run();
    } catch (err) {
      setBanner({ kind: "error", message: err instanceof ApiError ? err.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  };

  if (!Number.isInteger(bottleId) || bottleId <= 0) {
    return <ErrorView message="Invalid bottle id." />;
  }

  if (state.status === "loading") return <LoadingView label="Reading bottle detail and appraisal history…" />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={state.reload} />;

  const bottle = state.data;

  return (
    <div className="bottle-detail">
      <Link to="/" className="bottle-detail__back">
        ← Collection
      </Link>

      <div className="bottle-detail__header">
        <div className="bottle-detail__photo">
          <BottlePhoto src={bottle.photoUri} alt={bottle.bottleName} placeholderClassName="bottle-detail__photo-placeholder" />
        </div>
        <div>
          <p className="bottle-detail__distillery">{bottle.distillery}</p>
          <h1>{bottle.bottleName}</h1>
          <div className="bottle-detail__badges">
            <ConditionBadge condition={bottle.condition} fillLevelPercent={bottle.fillLevelPercent} />
            <span className="bottle-detail__stat">{bottle.proof.toFixed(1)} proof</span>
            <span className="bottle-detail__stat">{bottle.releaseYear}</span>
          </div>
        </div>
      </div>

      {banner && <TxStatusBanner state={banner} />}

      <div className="bottle-detail__grid">
        <section className="card bottle-detail__section">
          <div className="bottle-detail__section-head">
            <h2>Value over time</h2>
            <button
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() =>
                withBanner("Fetching an estimated value and recording it on-chain…", async () => {
                  const outcome = await api.refreshValuation(bottleId);
                  handleWriteOutcome(outcome, setBanner, () => state.reload());
                })
              }
            >
              ↻ Refresh value
            </button>
          </div>
          <ValueChart appraisals={bottle.appraisals} />
        </section>

        <section className="card bottle-detail__section">
          <h2>Details</h2>
          <dl className="bottle-detail__facts">
            <div>
              <dt>Purchase price</dt>
              <dd>${bottle.purchasePriceUsd}</dd>
            </div>
            <div>
              <dt>Purchase date</dt>
              <dd>{new Date(bottle.purchaseDate).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt>Owner (on-chain)</dt>
              <dd className="bottle-detail__mono">{bottle.owner}</dd>
            </div>
            <div>
              <dt>Photo hash</dt>
              <dd className="bottle-detail__mono">{bottle.photoHash.slice(0, 18)}…</dd>
            </div>
          </dl>

          <form
            className="bottle-detail__condition-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const condition = String(form.get("condition")) as Condition;
              const fillLevelPercent = Number(form.get("fillLevelPercent"));
              withBanner("Updating condition on-chain…", async () => {
                const outcome = await api.updateCondition(bottleId, condition, fillLevelPercent);
                handleWriteOutcome(outcome, setBanner, () => state.reload());
              });
            }}
          >
            <h3>Update condition</h3>
            <div className="field">
              <label htmlFor="condition">Condition</label>
              <select id="condition" name="condition" defaultValue={bottle.condition}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fillLevelPercent">Fill level (%)</label>
              <input
                id="fillLevelPercent"
                name="fillLevelPercent"
                type="number"
                min={0}
                max={100}
                step={0.5}
                defaultValue={bottle.fillLevelPercent}
              />
            </div>
            <button className="btn btn--secondary btn--sm" type="submit" disabled={busy}>
              Save
            </button>
          </form>
        </section>
      </div>

      <section className="card bottle-detail__section">
        <h2>Appraisal history</h2>
        <table className="bottle-detail__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Value</th>
              <th>Source</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {[...bottle.appraisals]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.timestamp).toLocaleDateString()}</td>
                  <td className="bottle-detail__table-value">${a.valueUsd}</td>
                  <td>{a.source}</td>
                  <td className="bottle-detail__table-note">{a.note}</td>
                </tr>
              ))}
          </tbody>
        </table>

        <form
          className="bottle-detail__manual-form"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(manualValue) * 100);
            if (!Number.isFinite(cents) || cents < 0) return;
            withBanner("Recording your appraisal on-chain…", async () => {
              const outcome = await api.recordAppraisal(bottleId, cents, manualNote);
              handleWriteOutcome(outcome, setBanner, () => state.reload());
              setManualValue("");
              setManualNote("");
            });
          }}
        >
          <h3>Record a manual appraisal</h3>
          <div className="bottle-detail__manual-fields">
            <div className="field">
              <label htmlFor="manualValue">Value (USD)</label>
              <input
                id="manualValue"
                type="number"
                min={0}
                step={0.01}
                required
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
              />
            </div>
            <div className="field field--grow">
              <label htmlFor="manualNote">Note</label>
              <input
                id="manualNote"
                type="text"
                placeholder="e.g. friend offered me this"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
              />
            </div>
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              Record
            </button>
          </div>
        </form>
      </section>

      <button className="btn btn--ghost" onClick={() => navigate(-1)}>
        ← Back
      </button>
    </div>
  );
}

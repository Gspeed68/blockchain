import { FormEvent, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { LoadingView, ErrorView } from "../components/StateViews";
import { StatusBadge } from "../components/StatusBadge";
import { CustodyTimeline } from "../components/CustodyTimeline";
import { TxStatusBanner, TxBannerState } from "../components/TxStatusBanner";
import type { RecordableEventType } from "../api/types";
import "./ItemDetailPage.css";

const RECORDABLE_EVENT_TYPES: RecordableEventType[] = ["Transferred", "Inspected", "Delivered", "Damaged", "Lost"];

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = Number(id);

  const load = useCallback(() => api.getItem(itemId), [itemId]);
  const state = useAsync(load, [itemId]);

  const [banner, setBanner] = useState<TxBannerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return <ErrorView message="Invalid item id." />;
  }

  if (state.status === "loading") return <LoadingView label="Reading item detail and custody history…" />;
  if (state.status === "error") return <ErrorView message={state.error} onRetry={state.reload} />;

  const item = state.data;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);

    try {
      let documentUri: string | undefined;
      let documentHash: string | undefined;

      if (docFile) {
        setBanner({ kind: "submitting", label: "Uploading document…" });
        const uploaded = await api.uploadDocument(docFile);
        documentUri = uploaded.documentUri;
        documentHash = uploaded.documentHash;
      }

      const form = new FormData(e.currentTarget);
      setBanner({ kind: "submitting", label: "Recording the custody event on-chain…" });

      const outcome = await api.recordCustodyEvent(itemId, {
        eventType: String(form.get("eventType")) as RecordableEventType,
        toCustodian: String(form.get("toCustodian")),
        location: String(form.get("location")),
        notes: String(form.get("notes") ?? ""),
        documentUri,
        documentHash,
      });

      if (outcome.status === "confirmed") {
        setBanner({ kind: "confirmed", txHash: outcome.transaction.txHash, blockNumber: outcome.transaction.blockNumber });
        (e.target as HTMLFormElement).reset();
        setDocFile(null);
        state.reload();
      } else {
        setBanner({ kind: "pending", txHash: outcome.txHash });
      }
    } catch (err) {
      setBanner({ kind: "error", message: err instanceof ApiError ? err.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="item-detail">
      <Link to="/" className="item-detail__back">
        ← Items
      </Link>

      <div className="item-detail__header">
        <div>
          <p className="item-detail__sku mono">{item.sku}</p>
          <h1>{item.description}</h1>
          <div className="item-detail__badges">
            <StatusBadge status={item.status} />
            {item.category && <span className="item-detail__stat">{item.category}</span>}
          </div>
        </div>
      </div>

      {banner && <TxStatusBanner state={banner} />}

      <div className="item-detail__grid">
        <section className="card item-detail__section">
          <h2>Current state</h2>
          <dl className="item-detail__facts">
            <div>
              <dt>Custodian</dt>
              <dd>{item.currentCustodian}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{item.currentLocation}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>{item.originLocation}</dd>
            </div>
            <div>
              <dt>Registered</dt>
              <dd>{new Date(item.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Registered by (on-chain)</dt>
              <dd className="mono">{item.registeredBy}</dd>
            </div>
          </dl>
        </section>

        <section className="card item-detail__section">
          <h2>Record a custody event</h2>
          <form className="item-detail__event-form" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="eventType">Event</label>
              <select id="eventType" name="eventType" defaultValue="Transferred">
                {RECORDABLE_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="toCustodian">Custodian</label>
              <input id="toCustodian" name="toCustodian" required defaultValue={item.currentCustodian} />
            </div>
            <div className="field">
              <label htmlFor="location">Location</label>
              <input id="location" name="location" required defaultValue={item.currentLocation} />
            </div>
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" rows={2} placeholder="Condition, handling instructions, etc." />
            </div>
            <div className="field">
              <label htmlFor="document">Supporting document (optional)</label>
              <input
                id="document"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
              Record event
            </button>
          </form>
        </section>
      </div>

      <section className="card item-detail__section">
        <h2>Chain of custody</h2>
        <CustodyTimeline events={item.custodyEvents} />
      </section>
    </div>
  );
}

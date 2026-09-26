import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { TxStatusBanner, TxBannerState } from "../components/TxStatusBanner";
import "./RegisterItemPage.css";

export function RegisterItemPage() {
  const navigate = useNavigate();
  const [banner, setBanner] = useState<TxBannerState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);

    try {
      let documentUri: string | undefined;
      let documentHash: string | undefined;

      if (docFile) {
        setBanner({ kind: "submitting", label: "Uploading intake document…" });
        const uploaded = await api.uploadDocument(docFile);
        documentUri = uploaded.documentUri;
        documentHash = uploaded.documentHash;
      }

      const form = new FormData(e.currentTarget);
      setBanner({ kind: "submitting", label: "Signing and sending the transaction (this can take a few seconds)…" });

      const outcome = await api.registerItem({
        sku: String(form.get("sku")),
        description: String(form.get("description")),
        category: String(form.get("category")),
        originLocation: String(form.get("originLocation")),
        initialCustodian: String(form.get("initialCustodian")),
        documentUri,
        documentHash,
      });

      if (outcome.status === "confirmed") {
        setBanner({ kind: "confirmed", txHash: outcome.transaction.txHash, blockNumber: outcome.transaction.blockNumber });
        setTimeout(() => navigate(`/items/${outcome.data.id}`), 700);
      } else {
        setBanner({ kind: "pending", txHash: outcome.txHash });
      }
    } catch (err) {
      setBanner({ kind: "error", message: err instanceof ApiError ? err.message : "Request failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="register-item-page">
      <h1>Register an item</h1>
      <p className="register-item-page__intro">
        This writes a new record to <code>CustodyRegistry</code> on-chain and seeds its custody history with the
        initial custodian.
      </p>

      <form className="card register-item-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sku">SKU / reference</label>
            <input id="sku" name="sku" required placeholder="SKU-00142" />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <input id="category" name="category" placeholder="pharmaceutical, fine-art, electronics…" />
          </div>
          <div className="field field--grow">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" required placeholder="Insulin shipment, 200 units" />
          </div>
          <div className="field">
            <label htmlFor="originLocation">Origin location</label>
            <input id="originLocation" name="originLocation" required placeholder="Basel DC" />
          </div>
          <div className="field">
            <label htmlFor="initialCustodian">Initial custodian</label>
            <input id="initialCustodian" name="initialCustodian" required placeholder="SwissCargo AG" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="document">Intake document (optional)</label>
          <input
            id="document"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
          />
          <span className="field-hint">A manifest, bill of lading, or photo — stored off-chain, hashed on-chain.</span>
        </div>

        {banner && <TxStatusBanner state={banner} />}

        <div className="register-item-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/")} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? "Submitting…" : "Register item"}
          </button>
        </div>
      </form>
    </div>
  );
}

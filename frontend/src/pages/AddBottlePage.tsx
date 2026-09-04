import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { TxStatusBanner, TxBannerState } from "../components/TxStatusBanner";
import type { Condition } from "../api/types";
import "./AddBottlePage.css";

const CONDITIONS: Condition[] = ["Sealed", "OpenPourable", "LowFill", "Empty", "Damaged"];

export function AddBottlePage() {
  const navigate = useNavigate();
  const [banner, setBanner] = useState<TxBannerState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const onPhotoChange = (file: File | null) => {
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);

    try {
      let photoUri = "";
      let photoHash: string | undefined;

      if (photoFile) {
        setBanner({ kind: "submitting", label: "Uploading photo…" });
        const uploaded = await api.uploadPhoto(photoFile);
        photoUri = uploaded.photoUri;
        photoHash = uploaded.photoHash;
      }

      const form = new FormData(e.currentTarget);
      setBanner({ kind: "submitting", label: "Signing and sending the transaction (this can take a few seconds)…" });

      const outcome = await api.addBottle({
        distillery: String(form.get("distillery")),
        bottleName: String(form.get("bottleName")),
        proof: Number(form.get("proof")),
        releaseYear: Number(form.get("releaseYear")),
        purchaseDate: String(form.get("purchaseDate")),
        purchasePriceCents: Math.round(Number(form.get("purchasePrice")) * 100),
        condition: String(form.get("condition")) as Condition,
        fillLevelPercent: Number(form.get("fillLevelPercent")),
        photoUri: photoUri || "https://placehold.co/600x800?text=No+Photo",
        photoHash,
      });

      if (outcome.status === "confirmed") {
        setBanner({ kind: "confirmed", txHash: outcome.transaction.txHash, blockNumber: outcome.transaction.blockNumber });
        setTimeout(() => navigate(`/bottles/${outcome.data.id}`), 700);
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
    <div className="add-bottle-page">
      <h1>Add a bottle</h1>
      <p className="add-bottle-page__intro">
        This writes a new record to <code>BottleRegistry</code> on-chain and seeds its appraisal history with your
        purchase price.
      </p>

      <form className="card add-bottle-form" onSubmit={onSubmit}>
        <div className="add-bottle-form__photo">
          <label htmlFor="photo" className="add-bottle-form__photo-drop">
            {photoPreview ? (
              <img src={photoPreview} alt="Bottle preview" />
            ) : (
              <>
                <span className="add-bottle-form__photo-icon">📷</span>
                <span>Add a photo</span>
              </>
            )}
          </label>
          <input
            id="photo"
            type="file"
            accept="image/*"
            onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            hidden
          />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="distillery">Distillery</label>
            <input id="distillery" name="distillery" required placeholder="Buffalo Trace" />
          </div>
          <div className="field">
            <label htmlFor="bottleName">Bottle name</label>
            <input id="bottleName" name="bottleName" required placeholder="E.H. Taylor Single Barrel" />
          </div>
          <div className="field">
            <label htmlFor="proof">Proof</label>
            <input id="proof" name="proof" type="number" step={0.1} min={0} max={200} required placeholder="100.6" />
          </div>
          <div className="field">
            <label htmlFor="releaseYear">Release year</label>
            <input id="releaseYear" name="releaseYear" type="number" min={1700} max={2100} required placeholder="2023" />
          </div>
          <div className="field">
            <label htmlFor="purchaseDate">Purchase date</label>
            <input id="purchaseDate" name="purchaseDate" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="purchasePrice">Purchase price (USD)</label>
            <input id="purchasePrice" name="purchasePrice" type="number" step={0.01} min={0} required placeholder="64.99" />
          </div>
          <div className="field">
            <label htmlFor="condition">Condition</label>
            <select id="condition" name="condition" defaultValue="Sealed">
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fillLevelPercent">Fill level (%)</label>
            <input id="fillLevelPercent" name="fillLevelPercent" type="number" min={0} max={100} step={0.5} defaultValue={100} />
          </div>
        </div>

        {banner && <TxStatusBanner state={banner} />}

        <div className="add-bottle-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/")} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? "Submitting…" : "Add bottle"}
          </button>
        </div>
      </form>
    </div>
  );
}

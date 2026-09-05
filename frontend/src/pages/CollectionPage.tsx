import { Link } from "react-router-dom";
import { useCallback } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { BottleCard } from "../components/BottleCard";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import "./CollectionPage.css";

export function CollectionPage() {
  const load = useCallback(() => api.listBottles(), []);
  const state = useAsync(load, []);

  return (
    <div className="collection-page">
      <div className="collection-page__intro">
        <h1>Your collection</h1>
        <p>Every bottle here is a record on your private chain — provenance, condition, and value history included.</p>
      </div>

      {state.status === "loading" && <LoadingView label="Reading your collection from the chain…" />}

      {state.status === "error" && <ErrorView message={state.error} onRetry={state.reload} />}

      {state.status === "success" && state.data.length === 0 && (
        <EmptyView
          title="No bottles yet"
          message="Add your first bottle to start its on-chain provenance record."
          action={
            <Link to="/bottles/new" className="btn btn--primary">
              + Add your first bottle
            </Link>
          }
        />
      )}

      {state.status === "success" && state.data.length > 0 && (
        <div className="collection-grid">
          {state.data.map((bottle) => (
            <BottleCard key={bottle.id} bottle={bottle} />
          ))}
        </div>
      )}
    </div>
  );
}

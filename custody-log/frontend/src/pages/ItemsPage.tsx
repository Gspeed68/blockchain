import { Link } from "react-router-dom";
import { useCallback } from "react";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { ItemCard } from "../components/ItemCard";
import { LoadingView, ErrorView, EmptyView } from "../components/StateViews";
import "./ItemsPage.css";

export function ItemsPage() {
  const load = useCallback(() => api.listItems(), []);
  const state = useAsync(load, []);

  return (
    <div className="items-page">
      <div className="items-page__intro">
        <h1>Items in custody</h1>
        <p>Every item here is a record on-chain — who has it, where it is, and its full chain of custody.</p>
      </div>

      {state.status === "loading" && <LoadingView label="Reading items from the chain…" />}

      {state.status === "error" && <ErrorView message={state.error} onRetry={state.reload} />}

      {state.status === "success" && state.data.length === 0 && (
        <EmptyView
          title="No items yet"
          message="Register your first item to start its on-chain custody trail."
          action={
            <Link to="/items/new" className="btn btn--primary">
              + Register your first item
            </Link>
          }
        />
      )}

      {state.status === "success" && state.data.length > 0 && (
        <div className="items-grid">
          {state.data.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

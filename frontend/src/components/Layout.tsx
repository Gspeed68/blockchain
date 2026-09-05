import { Link, Outlet, useLocation } from "react-router-dom";
import "./Layout.css";

export function Layout() {
  const location = useLocation();
  const isAddPage = location.pathname === "/bottles/new";

  return (
    <div className="layout">
      <header className="layout__header">
        <Link to="/" className="layout__brand">
          <span className="layout__brand-mark" aria-hidden="true">
            🥃
          </span>
          <span>
            Bourbon Registry
            <span className="layout__brand-sub">on-chain provenance for your collection</span>
          </span>
        </Link>
        {!isAddPage && (
          <Link to="/bottles/new" className="btn btn--primary">
            + Add bottle
          </Link>
        )}
      </header>
      <main className="layout__main">
        <Outlet />
      </main>
    </div>
  );
}

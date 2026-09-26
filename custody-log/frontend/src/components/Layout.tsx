import { Link, Outlet, useLocation } from "react-router-dom";
import "./Layout.css";

export function Layout() {
  const location = useLocation();
  const isRegisterPage = location.pathname === "/items/new";

  return (
    <div className="layout">
      <header className="layout__header">
        <Link to="/" className="layout__brand">
          <span className="layout__brand-mark" aria-hidden="true">
            📦
          </span>
          <span>
            Custody Log
            <span className="layout__brand-sub">on-chain chain-of-custody for physical items</span>
          </span>
        </Link>
        {!isRegisterPage && (
          <Link to="/items/new" className="btn btn--primary">
            + Register item
          </Link>
        )}
      </header>
      <main className="layout__main">
        <Outlet />
      </main>
    </div>
  );
}

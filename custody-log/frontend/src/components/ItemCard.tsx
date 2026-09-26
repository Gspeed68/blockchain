import { Link } from "react-router-dom";
import type { Item } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import "./ItemCard.css";

export function ItemCard({ item }: { item: Item }) {
  return (
    <Link to={`/items/${item.id}`} className="item-card">
      <div className="item-card__top">
        <span className="item-card__sku mono">{item.sku}</span>
        <StatusBadge status={item.status} />
      </div>
      <h3 className="item-card__description">{item.description}</h3>
      {item.category && <p className="item-card__category">{item.category}</p>}
      <div className="item-card__custody">
        <div>
          <span className="item-card__label">Custodian</span>
          <span className="item-card__value">{item.currentCustodian}</span>
        </div>
        <div>
          <span className="item-card__label">Location</span>
          <span className="item-card__value">{item.currentLocation}</span>
        </div>
      </div>
    </Link>
  );
}

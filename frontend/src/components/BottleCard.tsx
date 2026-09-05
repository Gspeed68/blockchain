import { Link } from "react-router-dom";
import type { Bottle } from "../api/types";
import { ConditionBadge } from "./ConditionBadge";
import { BottlePhoto } from "./BottlePhoto";
import "./BottleCard.css";

export function BottleCard({ bottle }: { bottle: Bottle }) {
  return (
    <Link to={`/bottles/${bottle.id}`} className="bottle-card">
      <div className="bottle-card__photo">
        <BottlePhoto
          src={bottle.photoUri}
          alt={`${bottle.distillery} ${bottle.bottleName}`}
          placeholderClassName="bottle-card__photo-placeholder"
        />
        <div className="bottle-card__badge">
          <ConditionBadge condition={bottle.condition} fillLevelPercent={bottle.fillLevelPercent} />
        </div>
      </div>
      <div className="bottle-card__body">
        <p className="bottle-card__distillery">{bottle.distillery}</p>
        <h3 className="bottle-card__name">{bottle.bottleName}</h3>
        <div className="bottle-card__meta">
          <span>{bottle.proof.toFixed(1)} proof</span>
          <span aria-hidden="true">·</span>
          <span>{bottle.releaseYear}</span>
        </div>
        <div className="bottle-card__price">
          <span className="bottle-card__price-label">Purchased</span>
          <span className="bottle-card__price-value">${bottle.purchasePriceUsd}</span>
        </div>
      </div>
    </Link>
  );
}

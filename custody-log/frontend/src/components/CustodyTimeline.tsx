import type { CustodyEvent, EventType } from "../api/types";
import "./CustodyTimeline.css";

const EVENT_ICON: Record<EventType, string> = {
  Registered: "🆕",
  Transferred: "🤝",
  Inspected: "🔍",
  Delivered: "✅",
  Damaged: "⚠️",
  Lost: "❌",
};

const EVENT_TONE: Record<EventType, string> = {
  Registered: "neutral",
  Transferred: "warning",
  Inspected: "neutral",
  Delivered: "good",
  Damaged: "serious",
  Lost: "critical",
};

/** Renders the append-only on-chain custody history, oldest first — the
 * order events actually happened in, which is also the order the contract
 * stores them in (see contracts/CustodyRegistry.sol note 2). */
export function CustodyTimeline({ events }: { events: CustodyEvent[] }) {
  const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <ol className="custody-timeline">
      {sorted.map((event) => (
        <li key={event.id} className={`custody-timeline__item custody-timeline__item--${EVENT_TONE[event.eventType]}`}>
          <span className="custody-timeline__icon" aria-hidden="true">
            {EVENT_ICON[event.eventType]}
          </span>
          <div className="custody-timeline__body">
            <div className="custody-timeline__head">
              <span className="custody-timeline__type">{event.eventType}</span>
              <span className="custody-timeline__date">{new Date(event.timestamp).toLocaleString()}</span>
            </div>
            <p className="custody-timeline__handoff">
              {event.fromCustodian ? (
                <>
                  <strong>{event.fromCustodian}</strong> → <strong>{event.toCustodian}</strong>
                </>
              ) : (
                <>
                  Registered to <strong>{event.toCustodian}</strong>
                </>
              )}
              <span className="custody-timeline__location"> · {event.location}</span>
            </p>
            {event.notes && <p className="custody-timeline__notes">{event.notes}</p>}
            {event.documentUri && (
              <a className="custody-timeline__doc" href={event.documentUri} target="_blank" rel="noreferrer">
                📄 View document
              </a>
            )}
            <p className="custody-timeline__meta mono">
              recorded by {event.recordedBy.slice(0, 10)}… · event #{event.id}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

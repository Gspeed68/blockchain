import { useState } from "react";

/**
 * A bottle photo with a graceful fallback: on-chain we only ever have a URI
 * (see contracts/BottleRegistry.sol) — that URI can rot, point at
 * something unreachable, or just fail to load. Falling back to the same
 * placeholder used for "no photo at all" beats a broken-image icon with
 * overlapping alt text either way.
 */
export function BottlePhoto({
  src,
  alt,
  placeholderClassName,
}: {
  src: string;
  alt: string;
  placeholderClassName: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={placeholderClassName} aria-hidden="true">
        🥃
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

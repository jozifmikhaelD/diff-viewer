/** Zoom in / out / fit controls shared by the map and flow panes. */
export function ZoomButtons({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  return (
    <div className="segmented zoom-buttons" role="group" aria-label="Zoom">
      <button type="button" onClick={() => onZoom(1 / 1.4)} title="Zoom out (scroll or pinch also works)" aria-label="Zoom out">
        −
      </button>
      <button type="button" onClick={() => onZoom(1.4)} title="Zoom in (scroll or pinch also works)" aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={onFit} title="Fit to the view">
        Fit
      </button>
    </div>
  );
}

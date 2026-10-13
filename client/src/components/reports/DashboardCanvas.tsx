import ReactGridLayout, {
  useContainerWidth,
  noCompactor,
  type Layout,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  resolveReportLayout,
  settleReportLayout,
  type ReportPageConfig,
  type ReportWidget,
} from "@tabdo/shared";

/** Responsive rendering never writes the narrow-screen arrangement back to storage. */
export function DashboardCanvas({
  config,
  editable,
  onChange,
  render,
}: {
  config: ReportPageConfig;
  editable: boolean;
  onChange: (page: ReportPageConfig) => void;
  render: (widget: ReportWidget, index: number) => ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const activeId = useRef<string | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const feedbackCard = useRef<HTMLElement | null>(null);
  const syncFeedback = (node: HTMLElement) => {
    feedbackCard.current = node.closest<HTMLElement>("[data-dashboard-item]") ?? node;
    if (frame.current != null) return;
    // Grid coordinates are rounded, but the dragged card uses continuous pixels.
    // Copy the rendered card after React's update so feedback follows both axes,
    // including intermediate positions and scrolling, without changing storage.
    const tick = () => {
      const surface = containerRef.current;
      const card = feedbackCard.current;
      if (!surface || !card?.isConnected) { frame.current = undefined;return; }
      surface.dataset.interacting = "true";
      surface.style.setProperty("--report-feedback-transform", card.style.transform);
      surface.style.setProperty("--report-feedback-width", card.style.width);
      surface.style.setProperty("--report-feedback-height", card.style.height);
      // RGL only calls onResize when the rounded grid size changes; reading
      // each interaction frame also covers movement within the same grid cell.
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const clearFeedback = () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    feedbackCard.current = null;
    if (containerRef.current) delete containerRef.current.dataset.interacting;
  };
  useEffect(() => clearFeedback, []);
  // Resolve collisions once, with the dragged item taking priority. RGL's
  // built-in collision mover otherwise relocates it before our compactor runs.
  const compactor = useMemo(
    () => ({
      ...noCompactor,
      allowOverlap: true,
      compact: (items: Layout) =>
        settleReportLayout(
          items.map((p) => ({ ...p, id: p.i })),
          activeId.current,
        ).map(({ id, ...p }) => p),
    }),
    [],
  );
  const narrow = width < 520;
  const canonical = resolveReportLayout(config);
  let y = 0;
  const layout = canonical.map(({ id, ...p }) => {
    const next = narrow ? { ...p, x: 0, y, w: 12 } : p;
    y += p.h;
    return { i: id, ...next, minW: 3, minH: 4, maxW: 12, maxH: 30 };
  });
  const persist = (next: Layout) => {
    if (!editable || narrow) return;
    const widgets = config.widgets.map((widget) => {
      const p = next.find((p) => p.i === widget.id)!;
      return {
        ...widget,
        layout: { x: p.x, y: p.y, w: p.w, h: p.h },
        width: p.w === 12 ? ("full" as const) : ("half" as const),
      };
    });
    if (JSON.stringify(widgets) !== JSON.stringify(config.widgets))
      onChange({ ...config, widgets });
  };
  return (
    <div
      ref={containerRef}
      data-testid="report-widgets"
      className="report-dashboard min-w-0
        [&_.react-grid-placeholder]:bg-primary! [&_.react-grid-placeholder]:opacity-12! [&_.react-grid-placeholder]:rounded-lg
        [&_.react-grid-placeholder]:transition-none! [&_.react-grid-placeholder]:pointer-events-none
        data-[interacting=true]:[&_.react-grid-placeholder]:[transform:var(--report-feedback-transform)]!
        data-[interacting=true]:[&_.react-grid-placeholder]:[width:var(--report-feedback-width)]!
        data-[interacting=true]:[&_.react-grid-placeholder]:[height:var(--report-feedback-height)]!
        [&_.react-resizable-handle]:size-6! [&_.react-resizable-handle]:bg-none! [&_.react-resizable-handle]:z-10
        [&_.react-resizable-handle]:after:border-muted-foreground! [&_.react-resizable-handle]:after:opacity-50
        [&_.react-grid-item:hover_.react-resizable-handle]:after:border-primary! [&_.react-grid-item:hover_.react-resizable-handle]:after:opacity-100"
    >
      {editable && narrow && (
        <p className="mb-3 text-xs text-muted-foreground">
          窄屏自动纵向排列，请在宽屏拖拽调整尺寸。
        </p>
      )}
      {mounted && width > 0 && (
        <ReactGridLayout
          width={width}
          layout={layout}
          compactor={compactor}
          gridConfig={{
            cols: 12,
            rowHeight: 32,
            margin: [16, 16],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: editable && !narrow,
            handle: ".report-drag-handle",
            cancel: ".report-widget-actions",
            threshold: 5,
            allowMobileScroll: true,
          }}
          resizeConfig={{ enabled: editable && !narrow, handles: ["se"] }}
        onDragStart={(_, item, ___, ____, _____, node) => {
            activeId.current = item?.i;
          if (node) syncFeedback(node);
          }}
        onResizeStart={(_, item, ___, ____, _____, node) => {
            activeId.current = item?.i;
          if (node) syncFeedback(node);
          }}
        onDrag={(_, __, item, placeholder, ___, node) => {
            // RGL creates its placeholder before moveElement, so copy the current
            // destination into it rather than showing the previous pointer step.
            if (item && placeholder)
              Object.assign(placeholder, {
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
              });
          if (node) syncFeedback(node);
          }}
        onResize={(_, __, ___, ____, _____, node) => { if (node) syncFeedback(node); }}
          onDragStop={(next) => {
          clearFeedback();
            persist(next);
            activeId.current = undefined;
          }}
          onResizeStop={(next) => {
          clearFeedback();
            persist(next);
            activeId.current = undefined;
          }}
        >
          {config.widgets.map((widget, index) => (
            <div
              key={widget.id}
              className="group"
              data-dashboard-item={widget.id}
            >
              {render(widget, index)}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

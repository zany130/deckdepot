import { Focusable, ProgressBar } from "@decky/ui";
import type { ReactElement } from "react";
import { OperationView } from "../types/operation";

function IndeterminateBar(): ReactElement {
  return (
    <div
      style={{
        position: "relative",
        height: "6px",
        borderRadius: "999px",
        background: "rgba(255,255,255,0.18)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: "40%",
          height: "100%",
          borderRadius: "999px",
          background: "#1a9fff",
          animation: "deckdepot-indet 1.2s ease-in-out infinite",
        }}
      />
      <style>{`@keyframes deckdepot-indet { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }`}</style>
    </div>
  );
}

export default function OperationProgress({
  view,
  compact,
}: {
  view: OperationView;
  compact?: boolean;
}): ReactElement {
  const fraction =
    view.progressKind === "fraction" && typeof view.progressPercent === "number";
  const bar =
    typeof ProgressBar === "function" ? (
      <ProgressBar
        indeterminate={!fraction}
        nProgress={fraction ? Math.max(0, Math.min(1, (view.progressPercent ?? 0) / 100)) : undefined}
        focusable={false}
      />
    ) : fraction ? (
      <div
        style={{
          height: "6px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, view.progressPercent ?? 0))}%`,
            height: "100%",
            borderRadius: "999px",
            background: "#1a9fff",
          }}
        />
      </div>
    ) : (
      <IndeterminateBar />
    );

  return (
    <Focusable
      onActivate={() => undefined}
      onOKActionDescription={view.label}
      style={{
        minWidth: compact ? "150px" : "180px",
        maxWidth: compact ? "220px" : "280px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: "13px",
          fontWeight: 650,
          marginBottom: "6px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {view.label}
        {fraction ? ` ${Math.round(view.progressPercent ?? 0)}%` : ""}
      </div>
      {view.active ? bar : null}
    </Focusable>
  );
}

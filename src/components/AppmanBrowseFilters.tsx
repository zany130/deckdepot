import { type ReactElement } from "react";
import { Focusable } from "@decky/ui";
import { APPMAN_FORMAT_FILTERS, APPMAN_SOURCE_LABELS } from "../browse/destinations";
import SegmentedControl from "./SegmentedControl";

export default function AppmanBrowseFilters({
  source,
  format,
  sources,
  onSource,
  onFormat,
}: {
  source: string;
  format: string;
  sources: readonly string[];
  onSource: (id: string) => void;
  onFormat: (id: string) => void;
}): ReactElement {
  const sourceOptions = [
    { id: "all", label: APPMAN_SOURCE_LABELS.all },
    ...sources
      .filter((id) => id !== "all")
      .map((id) => ({ id, label: APPMAN_SOURCE_LABELS[id] || id })),
  ];

  return (
    <Focusable
      flow-children="column"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "8px 18px 4px",
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: "12px", letterSpacing: "0.04em", opacity: 0.7, textTransform: "uppercase" }}>
        Catalog source
      </div>
      <SegmentedControl value={source} options={sourceOptions} onChange={onSource} />
      <div style={{ fontSize: "12px", letterSpacing: "0.04em", opacity: 0.7, textTransform: "uppercase" }}>
        Package format
      </div>
      <SegmentedControl value={format} options={[...APPMAN_FORMAT_FILTERS]} onChange={onFormat} />
    </Focusable>
  );
}

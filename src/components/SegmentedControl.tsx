import { Focusable } from "@decky/ui";
import { useState, type ReactElement } from "react";
import { focusOutline } from "./storeLayout";

export default function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}): ReactElement {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  return (
    <Focusable
      flow-children="row"
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      {options.map((option) => {
        const active = option.id === value;
        const focused = focusedId === option.id;
        return (
          <Focusable
            key={option.id}
            onActivate={() => onChange(option.id)}
            onOKActionDescription="Select"
            onGamepadFocus={() => setFocusedId(option.id)}
            onGamepadBlur={() => setFocusedId((current) => (current === option.id ? null : current))}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              fontWeight: active ? 700 : 500,
              fontSize: "14px",
              opacity: active ? 1 : 0.7,
              ...focusOutline(focused),
              background: active
                ? "rgba(26, 159, 255, 0.28)"
                : focused
                  ? "rgba(255, 255, 255, 0.14)"
                  : "rgba(255, 255, 255, 0.06)",
            }}
          >
            {option.label}
          </Focusable>
        );
      })}
    </Focusable>
  );
}

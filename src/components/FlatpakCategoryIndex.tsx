import { Focusable, TextField } from "@decky/ui";
import { useState, type ReactElement } from "react";
import { flatpakIndexSections } from "../browse/destinations";
import { focusOutline } from "./storeLayout";

export default function FlatpakCategoryIndex({
  onOpen,
}: {
  onOpen: (slug: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const sections = flatpakIndexSections()
    .map((section) => ({
      ...section,
      entries: section.entries.filter((item) => {
        if (!needle) {
          return true;
        }
        return item.label.toLowerCase().includes(needle) || item.id.includes(needle);
      }),
    }))
    .filter((section) => section.entries.length > 0);

  const buttonStyle = (id: string) => {
    const focused = focusedId === id;
    return {
      padding: "12px 14px",
      borderRadius: "8px",
      textAlign: "left" as const,
      fontWeight: 600,
      ...focusOutline(focused),
      background: focused ? "rgba(26, 159, 255, 0.28)" : "rgba(255, 255, 255, 0.06)",
    };
  };

  return (
    <Focusable
      flow-children="column"
      style={{ height: "100%", overflowY: "auto", padding: "8px 18px 28px", boxSizing: "border-box" }}
      onOKActionDescription="Open"
    >
      <div style={{ opacity: 0.75, fontSize: "14px", marginBottom: "10px" }}>
        New Arrivals, Recently Updated, and Popular stay here. Trending and the main categories stay
        on the top bar.
      </div>
      <TextField label="Find a category" value={query} onChange={(event) => setQuery(event.target.value)} />
      {sections.map((section) => (
        <div key={section.title}>
          <div
            style={{
              marginTop: "16px",
              marginBottom: "8px",
              fontSize: "12px",
              letterSpacing: "0.04em",
              opacity: 0.7,
              textTransform: "uppercase",
            }}
          >
            {section.title}
          </div>
          <Focusable
            flow-children="grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: "10px",
            }}
          >
            {section.entries.map((item) => (
              <Focusable
                key={item.id}
                onActivate={() => onOpen(item.id)}
                onOKActionDescription="Open"
                onGamepadFocus={() => setFocusedId(item.id)}
                onGamepadBlur={() => setFocusedId((current) => (current === item.id ? null : current))}
              >
                <div style={buttonStyle(item.id)}>{item.label}</div>
              </Focusable>
            ))}
          </Focusable>
        </div>
      ))}
      {sections.length === 0 ? (
        <div style={{ marginTop: "12px", opacity: 0.75 }}>No categories match.</div>
      ) : null}
    </Focusable>
  );
}

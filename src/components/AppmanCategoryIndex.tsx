import { Focusable, TextField } from "@decky/ui";
import { useState, type ReactElement } from "react";
import { APPMAN_SOFTWARE_CATEGORIES } from "../browse/destinations";
import { focusOutline } from "./storeLayout";

export default function AppmanCategoryIndex({
  onOpen,
  onOpenEverything,
}: {
  onOpen: (slug: string) => void;
  onOpenEverything: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const categories = APPMAN_SOFTWARE_CATEGORIES.filter((item) => {
    if (!needle) {
      return true;
    }
    return item.label.toLowerCase().includes(needle) || item.id.includes(needle);
  });

  const buttonStyle = (id: string, emphasized = false) => {
    const focused = focusedId === id;
    return {
      padding: "12px 14px",
      borderRadius: "8px",
      textAlign: "left" as const,
      fontWeight: emphasized ? 700 : 600,
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
        Software categories from the AppMan catalog. Package format and catalog source are the filters
        above, not categories.
      </div>
      <TextField label="Find a category" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Focusable
        style={{ marginTop: "12px" }}
        onActivate={onOpenEverything}
        onOKActionDescription="Open all applications"
        onGamepadFocus={() => setFocusedId("everything")}
        onGamepadBlur={() => setFocusedId((current) => (current === "everything" ? null : current))}
      >
        <div style={buttonStyle("everything", true)}>All applications</div>
      </Focusable>
      <div style={{ opacity: 0.65, fontSize: "13px", margin: "8px 0 12px" }}>
        Every application from the databases this AppMan install can install, including command-line
        tools and apps with no category.
      </div>
      <Focusable
        flow-children="grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "10px",
        }}
      >
        {categories.map((item) => (
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
      {categories.length === 0 ? (
        <div style={{ marginTop: "12px", opacity: 0.75 }}>No categories match.</div>
      ) : null}
    </Focusable>
  );
}

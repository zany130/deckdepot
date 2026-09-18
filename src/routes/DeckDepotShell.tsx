import { Focusable } from "@decky/ui";
import { useState, type CSSProperties, type ReactElement } from "react";
import { focusOutline, storeShellStyle } from "../components/storeLayout";
import InstalledRoute from "./InstalledRoute";
import SettingsRoute from "./SettingsRoute";
import StoreRoute from "./StoreRoute";
import UpdatesRoute from "./UpdatesRoute";

export type ShellSection = "flatpak" | "appman" | "installed" | "updates" | "settings";

const SECTIONS: Array<{ id: ShellSection; label: string }> = [
  { id: "flatpak", label: "Flatpak" },
  { id: "appman", label: "AppMan" },
  { id: "installed", label: "Installed" },
  { id: "updates", label: "Updates" },
  { id: "settings", label: "Settings" },
];

let lastSection: ShellSection = "flatpak";

const sidebarStyle: CSSProperties = {
  width: "188px",
  flexShrink: 0,
  height: "100%",
  padding: "16px 10px 20px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  background: "rgba(0, 0, 0, 0.28)",
  borderRight: "1px solid rgba(255, 255, 255, 0.08)",
};

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  overflow: "hidden",
};

export default function DeckDepotShell(): ReactElement {
  const [section, setSection] = useState<ShellSection>(lastSection);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const selectSection = (id: ShellSection) => {
    lastSection = id;
    setSection(id);
  };

  return (
    <Focusable
      flow-children="row"
      style={{ ...storeShellStyle, flexDirection: "row" }}
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
    >
      <Focusable flow-children="column" style={sidebarStyle}>
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.55,
            padding: "0 8px 10px",
          }}
        >
          DeckDepot
        </div>
        {SECTIONS.map((item) => {
          const active = item.id === section;
          const focused = focusedId === item.id;
          return (
            <Focusable
              key={item.id}
              preferredFocus={item.id === section}
              onActivate={() => selectSection(item.id)}
              onOKActionDescription="Open"
              onGamepadFocus={() => setFocusedId(item.id)}
              onGamepadBlur={() =>
                setFocusedId((current) => (current === item.id ? null : current))
              }
              style={{
                padding: "12px 12px",
                borderRadius: "8px",
                fontWeight: active ? 700 : 500,
                fontSize: "16px",
                opacity: active ? 1 : 0.72,
                ...focusOutline(focused),
                outline: focused
                  ? "3px solid #1a9fff"
                  : active
                    ? "1px solid rgba(26, 159, 255, 0.55)"
                    : "1px solid transparent",
                background: active
                  ? "rgba(26, 159, 255, 0.28)"
                  : focused
                    ? "rgba(255, 255, 255, 0.14)"
                    : "transparent",
                transform: focused ? "scale(1.02)" : "scale(1)",
              }}
            >
              {item.label}
            </Focusable>
          );
        })}
      </Focusable>
      <Focusable key={section} flow-children="column" style={contentStyle}>
        {section === "flatpak" ? <StoreRoute provider="flatpak" /> : null}
        {section === "appman" ? <StoreRoute provider="appman" /> : null}
        {section === "installed" ? <InstalledRoute /> : null}
        {section === "updates" ? <UpdatesRoute /> : null}
        {section === "settings" ? <SettingsRoute /> : null}
      </Focusable>
    </Focusable>
  );
}

import { Focusable, Marquee } from "@decky/ui";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from "react";
import { CatalogAppSummary } from "../types/catalog";
import { CatalogBadge } from "../api/installedInventory";
import { focusOutline } from "./storeLayout";

const tileStyle: CSSProperties = {
  borderRadius: "10px",
  padding: "12px 10px 14px",
  minHeight: "188px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px",
  width: "100%",
  boxSizing: "border-box",
};

export default function AppTile({
  app,
  preferredFocus,
  onOpen,
  onSearch,
  onFocused,
  badge,
  focusRef,
  showSourceChip = false,
}: {
  app: CatalogAppSummary;
  preferredFocus?: boolean;
  onOpen: () => void;
  onSearch?: () => void;
  onFocused?: () => void;
  badge?: CatalogBadge;
  focusRef?: Ref<HTMLDivElement>;
  showSourceChip?: boolean;
}): ReactElement {
  const [focused, setFocused] = useState(false);
  const [brokenIcon, setBrokenIcon] = useState(false);

  useEffect(() => {
    setBrokenIcon(false);
  }, [app.iconUrl]);

  return (
    <Focusable
      ref={focusRef}
      preferredFocus={preferredFocus}
      onActivate={() => onOpen()}
      onOKActionDescription="Select"
      onOptionsActionDescription={onSearch ? "Search" : undefined}
      onOptionsButton={
        onSearch
          ? (evt) => {
              evt.preventDefault();
              onSearch();
            }
          : undefined
      }
      onGamepadFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
      onGamepadBlur={() => setFocused(false)}
      style={{ ...tileStyle, ...focusOutline(focused), position: "relative" }}
    >
      {badge ? (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "3px 6px",
            borderRadius: "6px",
            background:
              badge === "update"
                ? "rgba(46, 204, 113, 0.9)"
                : badge === "installed"
                  ? "rgba(26, 159, 255, 0.9)"
                  : "rgba(255, 255, 255, 0.16)",
          }}
        >
          {badge === "update" ? "Update" : badge === "installed" ? "Installed" : "System"}
        </div>
      ) : null}
      {app.iconUrl && !brokenIcon ? (
        <img
          src={app.iconUrl}
          alt=""
          width={96}
          height={96}
          onError={() => setBrokenIcon(true)}
          style={{
            borderRadius: "18px",
            flexShrink: 0,
            objectFit: "cover",
            background: "rgba(0,0,0,0.25)",
          }}
        />
      ) : (
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "18px",
            flexShrink: 0,
            background: "rgba(255,255,255,0.1)",
          }}
        />
      )}
      <div
        style={{
          fontWeight: 650,
          fontSize: "15px",
          minWidth: 0,
          width: "100%",
          textAlign: "center",
        }}
      >
        <Marquee play={focused} center>
          {app.name}
        </Marquee>
      </div>
      <div
        style={{
          opacity: 0.72,
          fontSize: "12px",
          lineHeight: 1.3,
          width: "100%",
          textAlign: "center",
          height: "2.6em",
          overflow: "hidden",
        }}
      >
        {app.summary || app.appId}
      </div>
      {app.provider === "appman" ? (
        <div style={{ opacity: 0.55, fontSize: "10px", textTransform: "uppercase" }}>
          {app.sourceLabel || "AppMan"}
        </div>
      ) : showSourceChip && app.sourceLabel ? (
        <div style={{ opacity: 0.55, fontSize: "10px", textTransform: "uppercase" }}>
          {app.sourceLabel}
          {app.branch && app.branch !== "stable" ? ` · ${app.branch}` : ""}
        </div>
      ) : null}
    </Focusable>
  );
}

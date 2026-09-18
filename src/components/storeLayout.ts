import type { CSSProperties } from "react";

export const STEAM_HEADER_OFFSET_PX = 40;

export const storeShellStyle: CSSProperties = {
  marginTop: `${STEAM_HEADER_OFFSET_PX}px`,
  height: `calc(100% - ${STEAM_HEADER_OFFSET_PX}px)`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

export const embeddedShellStyle: CSSProperties = {
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

export const storePageStyle: CSSProperties = {
  ...storeShellStyle,
  overflowY: "auto",
  padding: "16px 24px 40px",
  gap: "16px",
};

export const embeddedPageStyle: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "16px 24px 40px",
  gap: "16px",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
};

export const browsePaneStyle: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "8px 18px 28px",
  boxSizing: "border-box",
};

export const appGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 196px), 1fr))",
  gap: "14px",
  width: "100%",
  alignContent: "start",
};

export const screenshotRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  gap: "12px",
  overflowX: "auto",
  paddingBottom: "8px",
};

export const focusOutline = (focused: boolean): CSSProperties => ({
  outline: focused ? "3px solid #1a9fff" : "1px solid rgba(255,255,255,0.06)",
  outlineOffset: "2px",
  background: focused ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.05)",
  boxShadow: focused ? "0 8px 24px rgba(0, 0, 0, 0.35)" : "none",
  transform: focused ? "scale(1.03)" : "scale(1)",
  transition: "transform 80ms ease-out, background 80ms ease-out, outline-color 80ms ease-out",
});

export function consumeGamepadEvent(evt: {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  stopImmediatePropagation?: () => void;
}): void {
  evt.preventDefault?.();
  evt.stopPropagation?.();
  evt.stopImmediatePropagation?.();
}

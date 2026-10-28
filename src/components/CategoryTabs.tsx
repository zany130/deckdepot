import {
  Focusable,
  GamepadButton,
  type GamepadEvent,
  type Tab,
} from "@decky/ui";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { cycleDestination } from "../browse/destinations";
import { consumeGamepadEvent } from "./storeLayout";

export default function CategoryTabs({
  activeTab,
  onShowTab,
  onSearch,
  bumperLabel = "Category",
  tabs,
}: {
  activeTab: string;
  onShowTab: (id: string) => void;
  onSearch?: () => void;
  bumperLabel?: string;
  tabs: Tab[];
}): ReactElement {
  const tabItems = tabs;
  const tabRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeTab]);

  return (
    <Focusable
      flow-children="column"
      style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}
      onOKActionDescription="Select"
      onCancelActionDescription="Back"
      onOptionsActionDescription={onSearch ? "Search" : undefined}
      onOptionsButton={
        onSearch
          ? (evt: GamepadEvent) => {
              consumeGamepadEvent(evt);
              onSearch();
            }
          : undefined
      }
    >
      <Focusable
        flow-children="row"
        style={{
          display: "flex",
          gap: "18px",
          padding: "10px 18px 12px",
          overflowX: "auto",
          flexShrink: 0,
          minWidth: 0,
          maxWidth: "100%",
          width: "100%",
          boxSizing: "border-box",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
        actionDescriptionMap={{
          [GamepadButton.BUMPER_LEFT]: bumperLabel,
          [GamepadButton.BUMPER_RIGHT]: bumperLabel,
        }}
        onButtonDown={(evt) => {
          if (
            evt.detail.button !== GamepadButton.BUMPER_LEFT &&
            evt.detail.button !== GamepadButton.BUMPER_RIGHT
          ) {
            return;
          }
          consumeGamepadEvent(evt);
          const ids = tabItems.map((tab) => tab.id);
          const delta = evt.detail.button === GamepadButton.BUMPER_LEFT ? -1 : 1;
          onShowTab(cycleDestination(ids, activeTab, delta));
        }}
      >
        {tabItems.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Focusable
              key={tab.id}
              ref={(node) => {
                if (node) {
                  tabRefs.current.set(tab.id, node);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              onActivate={() => onShowTab(tab.id)}
              onOKActionDescription="Select"
              style={{
                flexShrink: 0,
                padding: "6px 2px 10px",
                opacity: active ? 1 : 0.55,
                fontWeight: active ? 700 : 500,
                fontSize: "16px",
                borderBottom: active ? "3px solid #1a9fff" : "3px solid transparent",
              }}
            >
              {tab.title}
            </Focusable>
          );
        })}
      </Focusable>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {tabItems.find((tab) => tab.id === activeTab)?.content as ReactNode}
      </div>
    </Focusable>
  );
}

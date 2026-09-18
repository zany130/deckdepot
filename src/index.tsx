import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import {
  definePlugin,
  routerHook,
} from "@decky/api";
import { type ReactElement } from "react";
import { FaBoxOpen } from "react-icons/fa";
import {
  installTaskEventBridge,
  removeTaskEventBridge,
} from "./api/taskEvents";
import { openStoreRoute } from "./api/navigation";
import {
  DISCOVER_ROUTE,
  PLUGIN_DESCRIPTION,
  PLUGIN_DISPLAY_NAME,
  PLUGIN_TAGLINE,
  STORE_ROUTE,
} from "./constants";
import DeckDepotShell from "./routes/DeckDepotShell";
import { installSteamMenuInjection } from "./steam/mainMenuInjection";

function QamContent(): ReactElement {
  return (
    <PanelSection title={PLUGIN_DISPLAY_NAME}>
      <PanelSectionRow>
        <div style={{ opacity: 0.9 }}>{PLUGIN_TAGLINE}</div>
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ opacity: 0.75, fontSize: "14px" }}>{PLUGIN_DESCRIPTION}</div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => openStoreRoute()}>
          Open DeckDepot
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  console.log("[DeckDepot] frontend initializing");
  installTaskEventBridge();
  routerHook.addRoute(STORE_ROUTE, DeckDepotShell, { exact: true });
  routerHook.addRoute(DISCOVER_ROUTE, DeckDepotShell, { exact: true });
  const stopMenuInjection = installSteamMenuInjection();

  return {
    name: PLUGIN_DISPLAY_NAME,
    titleView: <div className={staticClasses.Title}>{PLUGIN_DISPLAY_NAME}</div>,
    content: <QamContent />,
    icon: <FaBoxOpen />,
    onDismount() {
      console.log("[DeckDepot] frontend dismounting");
      try {
        stopMenuInjection();
      } catch (exc) {
        console.log("[DeckDepot] menu injection unload failed", exc);
      }
      routerHook.removeRoute(STORE_ROUTE);
      routerHook.removeRoute(DISCOVER_ROUTE);
      removeTaskEventBridge();
    },
  };
});

import { toaster } from "@decky/api";

export function notifyOperation(message: string): void {
  const text = message.trim();
  if (!text) {
    return;
  }
  try {
    toaster.toast({
      title: text,
      body: "",
      duration: 4000,
      playSound: true,
      showToast: true,
    });
  } catch (exc) {
    console.log("[DeckDepot] toast failed", exc);
  }
}

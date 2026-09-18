import { Navigation } from "@decky/ui";
import { STORE_ROUTE } from "../constants";

export function openStoreRoute(): void {
  Navigation.Navigate(STORE_ROUTE);
}

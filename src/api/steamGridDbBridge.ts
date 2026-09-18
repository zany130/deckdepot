import { callable } from "@decky/api";
import {
  SteamGridDbAssetResult,
  SteamGridDbCapsuleResult,
  SteamGridDbStatus,
} from "../types/steamgriddb";

export const getSteamGridDbStatus = callable<[], SteamGridDbStatus>(
  "get_steamgriddb_status"
);

export const setSteamGridDbApiKey = callable<[apiKey: string], SteamGridDbStatus>(
  "set_steamgriddb_api_key"
);

export const clearSteamGridDbApiKey = callable<[], SteamGridDbStatus>(
  "clear_steamgriddb_api_key"
);

export const fetchSteamGridDbCapsule = callable<[name: string], SteamGridDbCapsuleResult>(
  "fetch_steamgriddb_capsule"
);

export const getSteamGridDbAsset = callable<[category: string], SteamGridDbAssetResult>(
  "get_steamgriddb_asset"
);

export type SteamGridDbStatus =
  | {
      ok: true;
      configured: boolean;
      tlsAvailable: boolean;
      tlsHelper: string;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

export type SteamGridDbAsset = {
  category: string;
  assetType: number;
  imageType: "png" | "jpg";
  byteLength?: number;
  base64: string;
};

export type SteamGridDbCapsuleResult =
  | {
      ok: true;
      skipped: false;
      matchedName: string;
      steamGridDbGameId: number;
      categories: string[];
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
      matchedName?: string;
      steamGridDbGameId?: number;
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

export type SteamGridDbAssetResult =
  | {
      ok: true;
      skipped: false;
      asset: SteamGridDbAsset;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

# P0.12 Flathub v2 schema (2026-09-16)

Live captures against `https://flathub.org/api/v2`. Host Python TLS and the
Decky `helpers.get_ssl_context()` path both reach these endpoints. CEF `fetch`
is still confirmed after plugin reload (preferred production catalog path).

## Search

```text
POST https://flathub.org/api/v2/search
{"query": "retroarch", "filters": []}
```

HTTP 200. Top-level keys:

`hits`, `query`, `processingTimeMs`, `hitsPerPage`, `page`, `totalPages`, `totalHits`, `facetDistribution`, `facetStats`

Pagination is page-based (`page`, `hitsPerPage`, `totalPages`, `totalHits`). Query `retroarch` returned 5 hits.

Hit identity:

- `app_id`: Flatpak ID with dots (`org.libretro.RetroArch`)
- `id`: search document id with underscores (`org_libretro_RetroArch`)
- `icon`: **single HTTPS URL string**
- `main_categories`: **string** (`game`), not an array
- also: `name`, `summary`, `description`, `type`, `developer_name`, `arches[]`, verification fields, `runtime`, timestamps

Guessed `filters: [{filterType:"category", value:"Game"}]` returned HTTP 500. Do **not** use that filter object until a working contract is proven.

## Appstream details

```text
GET https://flathub.org/api/v2/appstream/org.libretro.RetroArch
```

HTTP 200. Important fields:

- `id` / `name` / `summary` / `icon` (string URL)
- `icons[]`: `{url, width, height, type, scale}`
- `screenshots[]`: `{caption, default, sizes:[{src, width, height, scale}]}`
- `launchable`: `{type:"desktop-id", value:"org.libretro.RetroArch.desktop"}`
- `bundle`: `{type:"flatpak", value:"app/org.libretro.RetroArch/x86_64/stable", runtime, sdk}`
- `urls`, `releases[]`, `categories`, `developer_name`

The old fictitious catalog model of guessed `icons[]`/`sizes[]` TypeScript interfaces is **not** the production contract. Runtime-validate the live keys above. Search hits do not carry `icons[]` or screenshot `sizes[]`.

## Category

Working:

```text
GET https://flathub.org/api/v2/collection/category/{category}?page=1&per_page=5
```

Lowercase `game` works. Response shape matches search (`hits` + pagination). `game` had `totalHits` 728.

404 / unusable:

- `/api/v2/category/Game`
- `/api/v2/category/game`
- `/api/v2/feed/game`
- `/api/v2/appstream/category/Game`

Unpaginated `/api/v2/collection/category/Game` is huge (~425 KB). Production must paginate.

## Production consequence

- Catalog adapter validates search hits on `app_id` + `name` + `summary` + `icon` string.
- Details view validates appstream `id`/`icon`/`icons[]`/`screenshots[].sizes[].src`.
- Category UI uses `collection/category/{name}` with `page`/`per_page`, or is omitted if CEF fetch cannot reach it.

import * as z from "zod";

export const SearchHitSchema = z.object({
  app_id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  main_categories: z.string().nullable().optional(),
  developer_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  project_license: z.string().nullable().optional(),
  is_free_license: z.boolean().nullable().optional(),
  verification_verified: z.boolean().nullable().optional(),
  is_eol: z.boolean().nullable().optional(),
});

export const SearchResponseSchema = z.object({
  hits: z.array(z.unknown()),
  query: z.string().optional(),
  hitsPerPage: z.number().optional(),
  page: z.number().optional(),
  totalPages: z.number().optional(),
  totalHits: z.number().optional(),
});

const Dimension = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
});

export const ScreenshotSizeSchema = z.object({
  src: z.string().min(1),
  width: Dimension.optional(),
  height: Dimension.optional(),
  scale: z.union([z.string(), z.number()]).nullable().optional(),
});

export const ScreenshotSchema = z.object({
  caption: z.string().nullable().optional(),
  default: z.boolean().nullable().optional(),
  sizes: z.array(ScreenshotSizeSchema).nullable().optional(),
});

export const IconEntrySchema = z.object({
  url: z.string().min(1),
  width: Dimension.optional(),
  height: Dimension.optional(),
  type: z.string().nullable().optional(),
  scale: z.union([z.string(), z.number()]).nullable().optional(),
});

export const AppstreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  icons: z.array(z.unknown()).nullable().optional(),
  description: z.string().nullable().optional(),
  developer_name: z.string().nullable().optional(),
  project_license: z.string().nullable().optional(),
  is_free_license: z.boolean().nullable().optional(),
  is_eol: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  screenshots: z.array(z.unknown()).nullable().optional(),
  categories: z.array(z.unknown()).nullable().optional(),
  launchable: z
    .object({
      type: z.string().optional(),
      value: z.string().optional(),
    })
    .nullable()
    .optional(),
  bundle: z
    .object({
      type: z.string().optional(),
      value: z.string().optional(),
    })
    .nullable()
    .optional(),
  urls: z
    .object({
      homepage: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  releases: z.array(z.unknown()).nullable().optional(),
});

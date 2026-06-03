import { z } from "zod";

/**
 * RSS feed + folder management (MiniFlux-backed). Distinct from `Category` in
 * model.ts (which is a content type): a `FeedFolder` is a MiniFlux category used
 * to group feeds. Ids are stringified for a uniform API.
 */

export const FeedFolder = z.object({
  id: z.string(),
  title: z.string(),
  unreadCount: z.number().int().nonnegative().default(0),
});
export type FeedFolder = z.infer<typeof FeedFolder>;

export const Feed = z.object({
  id: z.string(),
  title: z.string(),
  feedUrl: z.url(),
  siteUrl: z.url().nullable().default(null),
  folderId: z.string().nullable().default(null),
  folderTitle: z.string().nullable().default(null),
  unreadCount: z.number().int().nonnegative().default(0),
});
export type Feed = z.infer<typeof Feed>;

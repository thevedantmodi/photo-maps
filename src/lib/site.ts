import type { Metadata } from 'next';

export const SITE_NAME = 'Photos by Vedant Modi';
export const AUTHOR = 'Vedant Modi';
export const SITE_DESCRIPTION =
  'Photos by Vedant Modi, pinned to the places they were taken. Browse the map by place and year.';

// Next.js replaces `alternates` wholesale rather than merging it, so any page that sets a
// canonical has to repeat the feed link or it disappears from that page's <head>.
export const RSS_ALTERNATE: NonNullable<Metadata['alternates']>['types'] = {
  'application/rss+xml': [{ url: '/feed.xml', title: SITE_NAME }],
};

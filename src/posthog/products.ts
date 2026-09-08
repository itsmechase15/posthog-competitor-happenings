/**
 * PostHog product marketing pages, so an action title can link the product it
 * names instead of leaving it as bare text. Only add a product whose URL has
 * been opened and checked: a feature that is not in here stays unlinked, which
 * reads fine, where a guessed URL sends the reader to a 404.
 */
export interface PostHogProduct {
  /** PostHog's own casing, which is sentence case: "Feature flags", not "Feature Flags". */
  label: string;
  url: string;
  /** Other ways a model writes the same product. Matched case-insensitively, like the label. */
  aliases?: string[];
}

const PRODUCTS: PostHogProduct[] = [
  { label: "Experiments", url: "https://posthog.com/experiments", aliases: ["experiment"] },
  {
    label: "Feature flags",
    url: "https://posthog.com/feature-flags",
    aliases: ["feature flag"],
  },
];

/** A model writes "feature flags", "Feature Flags", and "Feature  Flags" for the same thing. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_NAME = new Map<string, PostHogProduct>(
  PRODUCTS.flatMap((product) =>
    [product.label, ...(product.aliases ?? [])].map(
      (name) => [normalize(name), product] as const,
    ),
  ),
);

/** The product a feature name refers to, or undefined when we have no confident URL for it. */
export function findPostHogProduct(feature: string | undefined): PostHogProduct | undefined {
  return feature ? BY_NAME.get(normalize(feature)) : undefined;
}

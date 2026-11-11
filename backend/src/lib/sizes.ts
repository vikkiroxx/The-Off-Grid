// Variant.size is free-text with no canonical enum (apparel letters, numeric
// waist sizes, kids' ages all coexist) — alphabetical sort would put
// "L" < "M" < "S" < "XL", which is wrong for apparel. This orders known
// apparel letter sizes logically, falls back to numeric comparison for
// numeric sizes, and plain string comparison otherwise.
const APPAREL_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function compareSizes(a: string, b: string): number {
  const ai = APPAREL_SIZE_ORDER.indexOf(a.toUpperCase());
  const bi = APPAREL_SIZE_ORDER.indexOf(b.toUpperCase());
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;

  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;

  return a.localeCompare(b);
}

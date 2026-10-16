/** Hosts a "map link" setting may point to. Anything else is ignored, so an edited setting can never turn the map into a link to an arbitrary site. */
const GOOGLE_MAPS = /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)/;

/**
 * Google Maps for a postal address, without an API key:
 *  - `embed`: the small map shown on the page (keyless `output=embed` endpoint, centred on the address).
 *  - `open`:  where a click goes — the same address on Google Maps (official Maps URL), or the administrator's own Google Maps link if one is set.
 * Both come from the address published on the site, so the pin and the text can never disagree.
 */
export function googleMapsLinks(address: string, opts: { override?: string | null; hl?: string; zoom?: number } = {}): { embed: string; open: string } | null {
  const a = address.replace(/\s+/g, ' ').trim();
  if (!a) return null;
  const q = encodeURIComponent(a);
  const override = opts.override?.trim();
  return {
    embed: `https://www.google.com/maps?q=${q}&z=${opts.zoom ?? 16}&hl=${opts.hl ?? 'vi'}&output=embed`,
    open: override && GOOGLE_MAPS.test(override) ? override : `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}

import type { ProductCandidate } from "./types";

/**
 * Product discovery via Channel3 (one API over 100M+ products from 25k
 * retailers). Without CHANNEL3_API_KEY the app falls back to a small demo
 * catalog and labels every result as "demo" so nobody mistakes it for live
 * retail data.
 */

const BASE = process.env.CHANNEL3_BASE_URL ?? "https://api.trychannel3.com";

type C3Price = { price: number; compare_at_price?: number | null; currency: string };
type C3Offer = { url: string; domain: string; price: C3Price; availability?: string; condition?: string | null };
type C3Product = {
  id: string;
  title: string;
  description?: string | null;
  brands?: { id: string; name: string }[];
  images?: { url: string; is_main_image?: boolean }[];
  category?: { slug: string; title: string; path?: string } | null;
  offers?: C3Offer[];
};
type C3Response = { products: C3Product[]; next_page_token?: string | null };

export type SearchArgs = { query: string; maxPrice?: number; limit?: number; currency?: string; merchantDomains?: string[] };

export function channel3Enabled(): boolean {
  return Boolean(process.env.CHANNEL3_API_KEY);
}

export async function searchProducts(args: SearchArgs): Promise<ProductCandidate[]> {
  if (!channel3Enabled()) return demoSearch(args);
  const body: Record<string, unknown> = {
    query: args.query,
    limit: Math.min(args.limit ?? 8, 30),
    filters: {
      availability: ["InStock"],
      conditions: ["new"],
      ...(args.maxPrice ? { price: { max_price: args.maxPrice } } : {}),
      ...(args.merchantDomains?.length ? { website_ids: args.merchantDomains } : {}),
    },
    config: { currency: args.currency ?? "USD", country: "US", mode: "default" },
  };
  const res = await fetch(`${BASE}/v1/search`, {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Channel3 search failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as C3Response;
  return json.products.map(toCandidate);
}

function toCandidate(p: C3Product): ProductCandidate {
  const offers = (p.offers ?? []).filter((o) => (o.availability ?? "InStock") === "InStock");
  const sorted = [...offers].sort((a, b) => a.price.price - b.price.price);
  const best = sorted[0];
  const main = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? "",
    imageUrl: main?.url,
    category: p.category?.title ?? p.category?.slug ?? "",
    bestOffer: best
      ? { domain: best.domain, url: best.url, price: best.price.price, currency: best.price.currency, availability: best.availability ?? "InStock" }
      : null,
    offerCount: offers.length,
    source: "channel3",
  };
}

/* ------------------------------------------------------------------ */
/* Demo catalog, used only when no Channel3 key is configured.          */
/* ------------------------------------------------------------------ */

type DemoItem = { id: string; title: string; brand: string; category: string; tags: string[]; offers: { domain: string; price: number }[] };

const DEMO: DemoItem[] = [
  { id: "demo-ink-hp67", title: "HP 67XL Black High-Yield Ink Cartridge", brand: "HP", category: "Office Supplies > Printer Ink", tags: ["ink", "printer", "cartridge", "hp", "toner"], offers: [{ domain: "staples.com", price: 32.99 }, { domain: "amazon.com", price: 34.49 }, { domain: "bestbuy.com", price: 36.99 }] },
  { id: "demo-ink-canon", title: "Canon PG-245XL Black Ink Cartridge", brand: "Canon", category: "Office Supplies > Printer Ink", tags: ["ink", "printer", "cartridge", "canon"], offers: [{ domain: "amazon.com", price: 29.95 }, { domain: "officedepot.com", price: 31.49 }] },
  { id: "demo-paper", title: "Hammermill Copy Plus Paper, 8.5x11, 5 Reams", brand: "Hammermill", category: "Office Supplies > Paper", tags: ["paper", "copy paper", "reams", "printer paper"], offers: [{ domain: "amazon.com", price: 38.99 }, { domain: "staples.com", price: 44.99 }] },
  { id: "demo-coffee", title: "Lavazza Super Crema Whole Bean Coffee, 2.2 lb", brand: "Lavazza", category: "Grocery > Coffee", tags: ["coffee", "beans", "espresso", "whole bean"], offers: [{ domain: "amazon.com", price: 21.49 }, { domain: "walmart.com", price: 23.98 }] },
  { id: "demo-coffee-pods", title: "Nespresso Vertuo Pods Variety Pack, 30 ct", brand: "Nespresso", category: "Grocery > Coffee", tags: ["coffee", "pods", "nespresso", "capsules"], offers: [{ domain: "nespresso.com", price: 42.0 }, { domain: "amazon.com", price: 44.5 }] },
  { id: "demo-usb-c", title: "Anker 100W USB-C to USB-C Cable, 6ft, 2-pack", brand: "Anker", category: "Electronics > Cables", tags: ["usb-c", "cable", "charger", "anker", "usb"], offers: [{ domain: "amazon.com", price: 15.99 }, { domain: "anker.com", price: 17.99 }] },
  { id: "demo-mouse", title: "Logitech MX Master 3S Wireless Mouse", brand: "Logitech", category: "Electronics > Computer Accessories", tags: ["mouse", "wireless", "logitech", "ergonomic"], offers: [{ domain: "bestbuy.com", price: 99.99 }, { domain: "amazon.com", price: 94.99 }, { domain: "logitech.com", price: 99.99 }] },
  { id: "demo-keyboard", title: "Keychron K2 Wireless Mechanical Keyboard", brand: "Keychron", category: "Electronics > Computer Accessories", tags: ["keyboard", "mechanical", "wireless"], offers: [{ domain: "keychron.com", price: 89.0 }, { domain: "amazon.com", price: 94.0 }] },
  { id: "demo-headphones", title: "Sony WH-1000XM5 Noise Cancelling Headphones", brand: "Sony", category: "Electronics > Audio", tags: ["headphones", "sony", "noise cancelling", "audio"], offers: [{ domain: "bestbuy.com", price: 328.0 }, { domain: "amazon.com", price: 329.99 }] },
  { id: "demo-detergent", title: "Tide Pods Laundry Detergent, 112 ct", brand: "Tide", category: "Household > Laundry", tags: ["detergent", "laundry", "tide", "pods", "household"], offers: [{ domain: "target.com", price: 27.99 }, { domain: "amazon.com", price: 28.49 }] },
  { id: "demo-paper-towels", title: "Bounty Select-A-Size Paper Towels, 12 rolls", brand: "Bounty", category: "Household > Paper Goods", tags: ["paper towels", "bounty", "household", "kitchen"], offers: [{ domain: "walmart.com", price: 29.97 }, { domain: "amazon.com", price: 31.49 }] },
  { id: "demo-dog-food", title: "Purina Pro Plan Adult Dog Food, 35 lb", brand: "Purina", category: "Pets > Dog Food", tags: ["dog food", "pet", "purina", "kibble"], offers: [{ domain: "chewy.com", price: 74.98 }, { domain: "petco.com", price: 79.99 }] },
  { id: "demo-sneakers", title: "Nike Pegasus 41 Running Shoes", brand: "Nike", category: "Apparel > Shoes", tags: ["shoes", "sneakers", "running", "nike"], offers: [{ domain: "nike.com", price: 140.0 }, { domain: "zappos.com", price: 139.95 }] },
  { id: "demo-gift-card", title: "Steam Gift Card, $50", brand: "Steam", category: "Gift Cards > Gaming", tags: ["gift card", "steam", "games", "gaming"], offers: [{ domain: "amazon.com", price: 50.0 }] },
  { id: "demo-wine", title: "Caymus Cabernet Sauvignon 2022, 750ml", brand: "Caymus", category: "Alcohol > Wine", tags: ["wine", "cabernet", "alcohol"], offers: [{ domain: "wine.com", price: 89.99 }, { domain: "totalwine.com", price: 84.99 }] },
  { id: "demo-monitor", title: "Dell UltraSharp 27 4K Monitor U2723QE", brand: "Dell", category: "Electronics > Monitors", tags: ["monitor", "4k", "dell", "display"], offers: [{ domain: "dell.com", price: 619.99 }, { domain: "amazon.com", price: 599.0 }] },
];

function demoSearch(args: SearchArgs): ProductCandidate[] {
  const terms = args.query.toLowerCase().split(/[^a-z0-9+-]+/).filter((t) => t.length > 1);
  const scored = DEMO.map((item) => {
    const hay = `${item.title} ${item.brand} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { item, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const allowed = args.merchantDomains?.map((d) => d.toLowerCase());
  return scored
    .map(({ item }) => {
      let offers = item.offers;
      if (allowed?.length) offers = offers.filter((o) => allowed.some((d) => o.domain.endsWith(d)));
      if (args.maxPrice) offers = offers.filter((o) => o.price <= args.maxPrice!);
      const best = [...offers].sort((a, b) => a.price - b.price)[0];
      return {
        id: item.id,
        title: item.title,
        brand: item.brand,
        category: item.category,
        bestOffer: best
          ? { domain: best.domain, url: `https://${best.domain}/p/${item.id}`, price: best.price, currency: args.currency ?? "USD", availability: "InStock" }
          : null,
        offerCount: offers.length,
        source: "demo" as const,
      };
    })
    .slice(0, args.limit ?? 8);
}

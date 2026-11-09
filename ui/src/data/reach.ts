// Which cached pages a write can change (change:dashboard-reads-slow): a write to a record keyed under a product reaches
// the pages of that product and the pages that read every product; a write to a record under none reaches every page.

/** The product a record's key sits under (`change:<product>/…`, `product:<product>`), or null for a record under none
 *  (a session, a project, an actor, a source), whose write can reach any page. */
export function productOfKey(key: string): string | null {
  const m = /^(?:product:([^/]+)$|(?:change|feature|decision|aspect|place|release):([^/]+)\/)/.exec(key);
  return m?.[1] ?? m?.[2] ?? null;
}

/** Whether a query can show a write to one of `products`: one that names a product names it in its key (a node, a
 *  product, a record, each keyed under its product); one that names none (the store, the records, a session, a key
 *  without its product) reads every product. */
export function reaches(queryKey: readonly unknown[], products: Set<string>): boolean {
  const text = JSON.stringify(queryKey);
  const named = [
    ...text.matchAll(/"product:([^/"]+)"|(?:change|feature|decision|aspect|place|release):([^/"]+)\//g),
  ].map((m) => m[1] ?? m[2] ?? '');
  if (!named.length) return true;
  return named.some((p) => products.has(p));
}

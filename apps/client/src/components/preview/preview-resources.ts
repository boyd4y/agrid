export type PreviewResource = { id: string; name: string };
type ResourceApi = {
  listTables(): Promise<PreviewResource[]>;
  listSites(): Promise<PreviewResource[]>;
  listReports(offset: number, limit: number): Promise<{ reports: PreviewResource[]; hasMore: boolean }>;
};

/** No server search contract: read every authorized page before filtering locally. */
export async function loadPreviewResources(kind: string, api: ResourceApi, isCurrent: () => boolean): Promise<PreviewResource[]> {
  if (kind === "site") return api.listSites();
  if (kind !== "report") return api.listTables();
  const all: PreviewResource[] = [];
  for (let offset = 0; isCurrent(); offset += 100) {
    const page = await api.listReports(offset, 100);
    if (!isCurrent()) return [];
    all.push(...page.reports);
    if (!page.hasMore) break;
  }
  return all;
}

/** Duplicate labels keep their identity across searches and visible pages. */
export function filterPreviewResources(resources: PreviewResource[], search: string) {
  const names = new Map<string, number>();
  for (const item of resources) names.set(item.name, (names.get(item.name) ?? 0) + 1);
  const indices = new Map<string, number>();
  const query = search.trim().toLocaleLowerCase();
  return resources.map(item => {
    const index = (indices.get(item.name) ?? 0) + 1;
    indices.set(item.name, index);
    return { ...item, duplicateIndex: names.get(item.name)! > 1 ? index : null };
  }).filter(item => item.name.toLocaleLowerCase().includes(query));
}

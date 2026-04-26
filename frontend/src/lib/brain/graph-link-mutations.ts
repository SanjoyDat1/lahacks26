import type { BrianFile, GraphData } from "@/lib/brian/reader";

function resolveFile(files: BrianFile[], idOrPath: string): BrianFile | undefined {
  return files.find((f) => f.frontmatter.id === idOrPath || f.path === idOrPath);
}

function linkKey(source: string, target: string) {
  return `${source}→${target}`;
}

/** Add a directed link (matches /api/brain/links POST + buildGraphData ids). */
export function addGraphLink(
  graphData: GraphData,
  files: BrianFile[],
  sourceId: string,
  targetId: string,
): { graphData: GraphData; files: BrianFile[] } {
  const source = resolveFile(files, sourceId);
  const target = resolveFile(files, targetId);
  if (!source || !target) {
    throw new Error("Could not find source or target brain file.");
  }
  const sourceCanon = source.frontmatter.id ?? source.path;
  const targetCanon = target.frontmatter.id ?? target.path;
  const key = linkKey(sourceCanon, targetCanon);
  if (graphData.links.some((l) => linkKey(l.source, l.target) === key)) {
    return { graphData, files };
  }

  const nextLinks = [...graphData.links, { source: sourceCanon, target: targetCanon }];
  const nextFiles = files.map((f) => {
    if (f.path !== source.path) return f;
    const L = [...(f.frontmatter.links ?? [])];
    if (!L.includes(targetCanon)) L.push(targetCanon);
    return { ...f, frontmatter: { ...f.frontmatter, links: L } };
  });

  return { graphData: { ...graphData, links: nextLinks }, files: nextFiles };
}

/** Remove a directed link (matches /api/brain/links DELETE). */
export function removeGraphLink(
  graphData: GraphData,
  files: BrianFile[],
  sourceId: string,
  targetId: string,
): { graphData: GraphData; files: BrianFile[] } {
  const source = resolveFile(files, sourceId);
  const target = resolveFile(files, targetId);
  if (!source || !target) {
    return { graphData, files };
  }
  const targetCanon = target.frontmatter.id ?? target.path;
  const sourceCanon = source.frontmatter.id ?? source.path;

  const filteredGraphLinks = graphData.links.filter((l) => {
    const sameForward =
      (l.source === sourceCanon || l.source === sourceId) &&
      (l.target === targetCanon || l.target === targetId);
    return !sameForward;
  });

  const nextFiles = files.map((f) => {
    if (f.path !== source.path) return f;
    const L = (f.frontmatter.links ?? []).filter(
      (x) => x !== targetCanon && x !== target.path && x !== targetId,
    );
    return { ...f, frontmatter: { ...f.frontmatter, links: L } };
  });

  return { graphData: { ...graphData, links: filteredGraphLinks }, files: nextFiles };
}

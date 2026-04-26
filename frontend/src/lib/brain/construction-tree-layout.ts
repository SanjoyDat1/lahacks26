/**
 * Build a true directory + file tree from repo-relative paths and lay it out
 * for the session "construction graph" (parent/child edges match the real tree).
 */

export type PathTreeNode = {
  name: string;
  fullPath: string;
  subdirs: PathTreeNode[];
  files: PathTreeFile[];
};

/** Minimal file shape for layout (session `CreatedFile` satisfies this). */
export type PathTreeFile = {
  path: string;
  title?: string;
  preview?: string;
  status: string;
  links?: string[];
  isGhost?: boolean;
};

const GAP = 12;
const FILE_SLOT = 56;
const MIN_BLOCK = 88;

function comparePath(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** One directory node per path prefix; files attached to their parent folder. */
/** How many non-root directory prefixes exist in the file list (for UI counts). */
export function countPathDirectoryNodes(files: PathTreeFile[]): number {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      dirs.add(parts.slice(0, i + 1).join("/"));
    }
  }
  return dirs.size;
}

export function buildPathTreeFromFiles(files: PathTreeFile[]): PathTreeNode {
  const root: PathTreeNode = {
    name: "",
    fullPath: "",
    subdirs: [],
    files: [],
  };
  const byPath = new Map<string, PathTreeNode>([["", root]]);

  function ensureDir(p: string): PathTreeNode {
    const existing = byPath.get(p);
    if (existing) return existing;
    const parts = p.split("/").filter(Boolean);
    const name = parts[parts.length - 1] ?? "";
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const parent = ensureDir(parentPath);
    const node: PathTreeNode = {
      name,
      fullPath: p,
      subdirs: [],
      files: [],
    };
    byPath.set(p, node);
    if (!parent.subdirs.some((c) => c.fullPath === p)) parent.subdirs.push(node);
    parent.subdirs.sort((a, b) => comparePath(a.name, b.name));
    return node;
  }

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
      root.files.push(f);
      continue;
    }
    for (let i = 0; i < parts.length - 1; i++) {
      ensureDir(parts.slice(0, i + 1).join("/"));
    }
    const parentPath = parts.slice(0, -1).join("/");
    byPath.get(parentPath)!.files.push(f);
  }
  for (const n of byPath.values()) {
    n.files.sort((a, b) => comparePath(a.path, b.path));
  }
  return root;
}

function measure(node: PathTreeNode): number {
  const ch = [
    ...node.subdirs.map((d) => ({ k: "d" as const, d })),
    ...node.files.map((f) => ({ k: "f" as const, f })),
  ];
  if (ch.length === 0) return MIN_BLOCK;
  const widths = ch.map((c) => (c.k === "f" ? FILE_SLOT : measure(c.d)));
  const sum = widths.reduce((a, b) => a + b, 0) + (ch.length - 1) * GAP;
  return Math.max(MIN_BLOCK, sum);
}

export type PlacedDir = {
  path: string;
  name: string;
  x: number;
  y: number;
};

export type PlacedFile = {
  file: PathTreeFile;
  x: number;
  y: number;
  order: number;
};

export type TreeEdge = { x1: number; y1: number; x2: number; y2: number };

export type ConstructionTreeLayout = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  dirs: PlacedDir[];
  files: PlacedFile[];
  treeEdges: TreeEdge[];
  dirCount: number;
  fileCount: number;
};

const BRAIN_Y = 48;
const ROOT_CHILD_Y = 128;
const LEVEL_GAP = 52;

let orderSeq = 0;

function placeChildren(
  node: PathTreeNode,
  left: number,
  right: number,
  yRow: number,
  parent: { x: number; y: number },
  out: {
    dirs: PlacedDir[];
    files: PlacedFile[];
    treeEdges: TreeEdge[];
  },
) {
  const ch = [
    ...node.subdirs.map((d) => ({ k: "d" as const, d })),
    ...node.files.map((f) => ({ k: "f" as const, f })),
  ];
  if (ch.length === 0) return;

  const inner = right - left;
  const widths = ch.map((c) => (c.k === "f" ? FILE_SLOT : measure(c.d)));
  const total = widths.reduce((a, b) => a + b, 0) + (ch.length - 1) * GAP;
  const scale = inner / total;

  let cur = left;
  for (let i = 0; i < ch.length; i++) {
    const w = widths[i]! * scale;
    const c = ch[i]!;
    const l = cur;
    const r = l + w;
    cur = r + GAP;
    const cx = (l + r) / 2;
    if (c.k === "f") {
      out.files.push({ file: c.f, x: cx, y: yRow, order: orderSeq++ });
      out.treeEdges.push({ x1: parent.x, y1: parent.y, x2: cx, y2: yRow });
    } else {
      const yDir = yRow;
      out.dirs.push({ path: c.d.fullPath, name: c.d.name, x: cx, y: yDir });
      out.treeEdges.push({ x1: parent.x, y1: parent.y, x2: cx, y2: yDir });
      const yNext = yDir + LEVEL_GAP;
      placeChildren(c.d, l, r, yNext, { x: cx, y: yDir }, out);
    }
  }
}

/**
 * Top-center repo node at (width/2, BRAIN_Y); tree below with proportional columns.
 */
export function layoutPathTree(
  root: PathTreeNode,
  viewMinWidth: number,
): ConstructionTreeLayout {
  orderSeq = 0;
  const m = measure(root);
  const width = Math.max(viewMinWidth, m + 96);
  const left = 48;
  const right = width - 48;
  const centerX = width / 2;
  const centerY = BRAIN_Y;

  const out: { dirs: PlacedDir[]; files: PlacedFile[]; treeEdges: TreeEdge[] } = {
    dirs: [],
    files: [],
    treeEdges: [],
  };

  const ch = [
    ...root.subdirs.map((d) => ({ k: "d" as const, d })),
    ...root.files.map((f) => ({ k: "f" as const, f })),
  ];
  if (ch.length) {
    const inner = right - left;
    const widths = ch.map((c) => (c.k === "f" ? FILE_SLOT : measure(c.d)));
    const total = widths.reduce((a, b) => a + b, 0) + (ch.length - 1) * GAP;
    const scale = inner / total;

    let cur = left;
    for (let i = 0; i < ch.length; i++) {
      const w = widths[i]! * scale;
      const c = ch[i]!;
      const l = cur;
      const r = l + w;
      cur = r + GAP;
      const cx = (l + r) / 2;
      if (c.k === "f") {
        out.files.push({ file: c.f, x: cx, y: ROOT_CHILD_Y, order: orderSeq++ });
        out.treeEdges.push({ x1: centerX, y1: centerY, x2: cx, y2: ROOT_CHILD_Y });
      } else {
        const yDir = ROOT_CHILD_Y;
        out.dirs.push({ path: c.d.fullPath, name: c.d.name, x: cx, y: yDir });
        out.treeEdges.push({ x1: centerX, y1: centerY, x2: cx, y2: yDir });
        const yNext = yDir + LEVEL_GAP;
        placeChildren(c.d, l, r, yNext, { x: cx, y: yDir }, out);
      }
    }
  }

  const maxY = (() => {
    let mY = centerY;
    for (const d of out.dirs) mY = Math.max(mY, d.y);
    for (const f of out.files) mY = Math.max(mY, f.y);
    return mY;
  })();

  return {
    width,
    height: Math.max(480, maxY + 88),
    centerX,
    centerY,
    dirs: out.dirs,
    files: out.files,
    treeEdges: out.treeEdges,
    dirCount: out.dirs.length,
    fileCount: out.files.length,
  };
}

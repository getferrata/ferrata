/**
 * Prerequisite-graph visualization: a layered left-to-right DAG.
 * Pure and deterministic (server-rendered SVG). The ordered "La via" list is the
 * accessible source of truth; this is a visual complement, so it is aria-hidden
 * and the whole figure carries a text label.
 */

interface Node {
  id: string;
  title: string;
  /** Where clicking this concept goes. Omitted while the module is unwritten. */
  href?: string;
}
interface Edge {
  from: string;
  to: string;
}

const NODE_W = 168;
const NODE_H = 40;
const COL_GAP = 56;
const ROW_GAP = 14;
const PAD = 12;

function computeLayers(nodes: Node[], edges: Edge[]): Map<string, number> {
  const prereqs = new Map<string, string[]>();
  for (const n of nodes) prereqs.set(n.id, []);
  for (const e of edges) {
    if (prereqs.has(e.to) && prereqs.has(e.from)) prereqs.get(e.to)!.push(e.from);
  }
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard (shouldn't happen on a DAG)
    visiting.add(id);
    const ps = prereqs.get(id) ?? [];
    const d = ps.length === 0 ? 0 : Math.max(...ps.map((p) => depth(p) + 1));
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);
  return layer;
}

export function ConceptGraph({
  nodes,
  edges,
  currentId,
}: {
  nodes: Node[];
  edges: Edge[];
  /** When set, this node is emphasised ("you are here"). */
  currentId?: string;
}) {
  if (nodes.length === 0) return null;
  const layer = computeLayers(nodes, edges);

  const byLayer = new Map<number, Node[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(n);
    byLayer.set(l, arr);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(...[...byLayer.values()].map((v) => v.length));

  const pos = new Map<string, { x: number; y: number }>();
  for (const l of layers) {
    const col = byLayer.get(l)!;
    const totalH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const offsetY = (maxRows * NODE_H + (maxRows - 1) * ROW_GAP - totalH) / 2;
    col.forEach((n, i) => {
      pos.set(n.id, {
        x: PAD + l * (NODE_W + COL_GAP),
        y: PAD + offsetY + i * (NODE_H + ROW_GAP),
      });
    });
  }

  const width = PAD * 2 + layers.length * NODE_W + (layers.length - 1) * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

  const clickable = nodes.some((n) => n.href);

  return (
    <figure
      role="group"
      aria-label={`Prerequisite graph: ${nodes.length} concepts in ${layers.length} layers`}
    >
      <div className="overflow-x-auto" tabIndex={0}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="max-w-none"
        aria-hidden
      >
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5}
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const current = n.id === currentId;
          const label = current ? `${n.title} (you are here)` : n.title;
          const body = (
            <>
              <title>{label}</title>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={current ? "var(--accent)" : "var(--surface)"}
                stroke={current ? "var(--accent)" : "var(--border)"}
                strokeWidth={current ? 2 : 1.5}
              />
              <circle
                cx={p.x}
                cy={p.y + NODE_H / 2}
                r={3}
                fill={current ? "var(--accent-contrast)" : "var(--accent)"}
              />
              <text
                x={p.x + 14}
                y={p.y + NODE_H / 2 + 4}
                fontSize={12}
                fontFamily="var(--font-sans)"
                fill={current ? "var(--accent-contrast)" : "var(--text)"}
              >
                {n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title}
              </text>
            </>
          );
          // Linked nodes open the module. The same destinations are in the
          // ordered route list below, which is the accessible path, so these
          // stay out of the tab order to avoid duplicating every stop.
          return n.href ? (
            <a
              key={n.id}
              href={n.href}
              tabIndex={-1}
              className="cursor-pointer [&>rect]:transition-[stroke] hover:[&>rect]:stroke-accent"
            >
              {body}
            </a>
          ) : (
            <g key={n.id}>{body}</g>
          );
        })}
        </svg>
      </div>
      <figcaption className="mt-3 text-step--1 text-text-muted">
        {clickable ? "Click a concept to open it." : "Concepts appear here as they are written."}
        {width > 780 ? " Scroll sideways to see the whole map." : ""}
      </figcaption>
    </figure>
  );
}

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import {
  GlobeIcon, CheckCircleIcon, ClockIcon, BlockedIcon, LayersIcon,
  SearchIcon, ExportIcon, MaximizeIcon, RefreshCw, GitBranch,
  CloseIcon, CopyIcon, FolderIcon, InfoIcon, ShieldCheckIcon
} from '../components/icons';
import type { Project, DiscoveryRun, DiscoveryCandidate } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  label: string;
  path: string;
  depth: number;
  direction?: 'left' | 'right';
  method?: string;
  verificationStatus?: string;
  httpStatus?: number | null;
  responseTime?: number | null;
  source?: string;
  confidence?: string;
  childCount?: number;
  children?: TreeNode[];
  candidates?: DiscoveryCandidate[];
}

interface Point {
  x: number;
  y: number;
}

// ─── Dimensions helper ────────────────────────────────────────────────────────

function getNodeDimensions(depth: number): { w: number; h: number } {
  if (depth === 0) return { w: 280, h: 72 };
  if (depth === 1) return { w: 210, h: 52 };
  if (depth === 2) return { w: 190, h: 46 };
  return { w: 240, h: 38 };
}

// ─── Tree builder: group candidates by path prefix ───────────────────────────

function buildTree(
  rootUrl: string,
  candidates: DiscoveryCandidate[],
  searchQuery: string,
  methodFilter: string,
  statusFilter: string,
  sourceFilter: string,
): TreeNode {
  let filtered = candidates;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.path.toLowerCase().includes(q) ||
      c.full_url.toLowerCase().includes(q)
    );
  }
  if (methodFilter !== 'All Methods') {
    filtered = filtered.filter(c => c.method.toUpperCase() === methodFilter);
  }
  if (statusFilter !== 'All Status') {
    const sv = statusFilter.toUpperCase();
    filtered = filtered.filter(c => c.verification_status === sv);
  }
  if (sourceFilter !== 'All Sources') {
    filtered = filtered.filter(c => c.source === sourceFilter.toUpperCase());
  }

  // Group by first path segment
  const groups: Record<string, DiscoveryCandidate[]> = {};
  for (const c of filtered) {
    const segments = c.path.replace(/^\//, '').split('/');
    const groupKey = segments[0] ? `/${segments[0]}` : '/';
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(c);
  }

  const rootChildren: TreeNode[] = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupPath, groupCandidates]) => {
      // Sub-group by second segment
      const subGroups: Record<string, DiscoveryCandidate[]> = {};
      for (const c of groupCandidates) {
        const segs = c.path.replace(/^\//, '').split('/');
        const subKey = segs.length > 1 ? `/${segs.slice(0, 2).join('/')}` : c.path;
        if (!subGroups[subKey]) subGroups[subKey] = [];
        subGroups[subKey].push(c);
      }

      const subChildren: TreeNode[] = Object.entries(subGroups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subPath, subCandidates]) => ({
          id: `sub-${subPath}`,
          label: subPath,
          path: subPath,
          depth: 2,
          childCount: subCandidates.length,
          candidates: subCandidates,
          children: subCandidates.map(c => ({
            id: `leaf-${c.id}`,
            label: c.path,
            path: c.path,
            depth: 3,
            method: c.method,
            verificationStatus: c.verification_status,
            httpStatus: c.http_status,
            responseTime: c.response_time_ms,
            source: c.source,
            confidence: c.confidence,
            candidates: [c],
          })),
        }));

      return {
        id: `group-${groupPath}`,
        label: groupPath,
        path: groupPath,
        depth: 1,
        childCount: groupCandidates.length,
        children: subChildren,
      };
    });

  return {
    id: 'root',
    label: rootUrl,
    path: '/',
    depth: 0,
    childCount: filtered.length,
    children: rootChildren,
  };
}

// ─── Static demo tree (used when no real projects exist yet) ─────────────────

function buildDefaultTree(): TreeNode {
  return {
    id: 'root', label: 'https://api.example.com', path: '/', depth: 0, childCount: 52,
    children: [
      {
        id: 'group-api', label: '/api', path: '/api', depth: 1, childCount: 12,
        children: [
          {
            id: 'sub-api-auth', label: '/api/auth', path: '/api/auth', depth: 2, childCount: 3,
            candidates: [],
            children: [
              { id: 'l1', label: '/api/auth/login', path: '/api/auth/login', depth: 3, method: 'POST', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l2', label: '/api/auth/register', path: '/api/auth/register', depth: 3, method: 'POST', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l3', label: '/api/auth/refresh', path: '/api/auth/refresh', depth: 3, method: 'GET', verificationStatus: 'UNAVAILABLE', source: 'CRAWLER', confidence: 'MEDIUM', candidates: [] },
            ],
          },
          {
            id: 'sub-api-users', label: '/api/users', path: '/api/users', depth: 2, childCount: 3,
            candidates: [],
            children: [
              { id: 'l4', label: '/api/users', path: '/api/users', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l5', label: '/api/users/{id}', path: '/api/users/{id}', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'JAVASCRIPT', confidence: 'MEDIUM', candidates: [] },
              { id: 'l6', label: '/api/users/{id}', path: '/api/users/{id}', depth: 3, method: 'PUT', verificationStatus: 'VERIFIED', source: 'JAVASCRIPT', confidence: 'MEDIUM', candidates: [] },
            ],
          },
        ],
      },
      {
        id: 'group-v1', label: '/v1', path: '/v1', depth: 1, childCount: 16,
        children: [
          {
            id: 'sub-v1-payments', label: '/v1/payments', path: '/v1/payments', depth: 2, childCount: 2,
            candidates: [],
            children: [
              { id: 'l7', label: '/v1/payments/charge', path: '/v1/payments/charge', depth: 3, method: 'POST', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l8', label: '/v1/payments/refund', path: '/v1/payments/refund', depth: 3, method: 'POST', verificationStatus: 'BLOCKED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
            ],
          },
          {
            id: 'sub-v1-invoices', label: '/v1/invoices', path: '/v1/invoices', depth: 2, childCount: 2,
            candidates: [],
            children: [
              { id: 'l9', label: '/v1/invoices', path: '/v1/invoices', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'CRAWLER', confidence: 'HIGH', candidates: [] },
              { id: 'l10', label: '/v1/invoices/{id}/pdf', path: '/v1/invoices/{id}/pdf', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'CRAWLER', confidence: 'MEDIUM', candidates: [] },
            ],
          },
        ],
      },
      {
        id: 'group-health', label: '/health', path: '/health', depth: 1, childCount: 4,
        children: [
          {
            id: 'sub-health-status', label: '/health/ready', path: '/health/ready', depth: 2, childCount: 2,
            candidates: [],
            children: [
              { id: 'l11', label: '/health/ready', path: '/health/ready', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l12', label: '/health/live', path: '/health/live', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
            ],
          },
        ],
      },
      {
        id: 'group-docs', label: '/docs', path: '/docs', depth: 1, childCount: 3,
        children: [
          {
            id: 'sub-docs-spec', label: '/docs/openapi', path: '/docs/openapi', depth: 2, childCount: 2,
            candidates: [],
            children: [
              { id: 'l13', label: '/docs/openapi.json', path: '/docs/openapi.json', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'OPENAPI', confidence: 'HIGH', candidates: [] },
              { id: 'l14', label: '/docs/swagger', path: '/docs/swagger', depth: 3, method: 'GET', verificationStatus: 'VERIFIED', source: 'CRAWLER', confidence: 'HIGH', candidates: [] },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Layout calculation algorithm ────────────────────────────────────────────

function computeSubtreeHeight(node: TreeNode, collapsed: Set<string>): number {
  if (node.depth === 3 || !node.children?.length || collapsed.has(node.id)) {
    return node.depth === 3 ? 46 : node.depth === 2 ? 56 : 64;
  }
  let sum = 0;
  for (const child of node.children) {
    sum += computeSubtreeHeight(child, collapsed);
  }
  return Math.max(sum, node.depth === 1 ? 64 : 56);
}

function computeLayout(
  tree: TreeNode,
  collapsed: Set<string>,
  layoutMode: 'balanced' | 'horizontal'
): Record<string, Point> {
  const positions: Record<string, Point> = {};
  const rootChildren = tree.children || [];

  if (layoutMode === 'horizontal') {
    // Flow mode: Root at left, all branches flowing right
    const rootPos = { x: 120, y: 700 };
    positions[tree.id] = rootPos;

    let totalTreeH = 0;
    for (const group of rootChildren) {
      totalTreeH += computeSubtreeHeight(group, collapsed);
    }

    let topY = Math.max(60, rootPos.y - totalTreeH / 2 + 36);

    for (const group of rootChildren) {
      const gH = computeSubtreeHeight(group, collapsed);
      const groupY = topY + gH / 2 - 26;
      const groupX = rootPos.x + 360;
      positions[group.id] = { x: groupX, y: groupY };

      if (!collapsed.has(group.id) && group.children) {
        let subTopY = topY;
        for (const sub of group.children) {
          const sH = computeSubtreeHeight(sub, collapsed);
          const subY = subTopY + sH / 2 - 23;
          const subX = groupX + 280;
          positions[sub.id] = { x: subX, y: subY };

          if (!collapsed.has(sub.id) && sub.children) {
            let leafY = subTopY;
            for (const leaf of sub.children) {
              positions[leaf.id] = { x: subX + 270, y: leafY };
              leafY += 46;
            }
          }
          subTopY += sH;
        }
      }
      topY += gH;
    }
  } else {
    // Balanced mode: Left branches <--- Root ---> Right branches
    const rootPos = { x: 1400, y: 700 };
    positions[tree.id] = rootPos;

    const leftGroups: TreeNode[] = [];
    const rightGroups: TreeNode[] = [];
    rootChildren.forEach((child, idx) => {
      if (idx % 2 === 1) leftGroups.push(child);
      else rightGroups.push(child);
    });

    // Place Right groups
    let rightTotalH = 0;
    for (const g of rightGroups) rightTotalH += computeSubtreeHeight(g, collapsed);
    let rightTopY = Math.max(60, rootPos.y - rightTotalH / 2 + 36);

    for (const group of rightGroups) {
      const gH = computeSubtreeHeight(group, collapsed);
      const groupY = rightTopY + gH / 2 - 26;
      const groupX = rootPos.x + 360;
      positions[group.id] = { x: groupX, y: groupY };

      if (!collapsed.has(group.id) && group.children) {
        let subTopY = rightTopY;
        for (const sub of group.children) {
          const sH = computeSubtreeHeight(sub, collapsed);
          const subY = subTopY + sH / 2 - 23;
          const subX = groupX + 280;
          positions[sub.id] = { x: subX, y: subY };

          if (!collapsed.has(sub.id) && sub.children) {
            let leafY = subTopY;
            for (const leaf of sub.children) {
              positions[leaf.id] = { x: subX + 270, y: leafY };
              leafY += 46;
            }
          }
          subTopY += sH;
        }
      }
      rightTopY += gH;
    }

    // Place Left groups
    let leftTotalH = 0;
    for (const g of leftGroups) leftTotalH += computeSubtreeHeight(g, collapsed);
    let leftTopY = Math.max(60, rootPos.y - leftTotalH / 2 + 36);

    for (const group of leftGroups) {
      const gH = computeSubtreeHeight(group, collapsed);
      const groupY = leftTopY + gH / 2 - 26;
      const groupX = rootPos.x - 360 - 210;
      positions[group.id] = { x: groupX, y: groupY };

      if (!collapsed.has(group.id) && group.children) {
        let subTopY = leftTopY;
        for (const sub of group.children) {
          const sH = computeSubtreeHeight(sub, collapsed);
          const subY = subTopY + sH / 2 - 23;
          const subX = groupX - 280 - 190;
          positions[sub.id] = { x: subX, y: subY };

          if (!collapsed.has(sub.id) && sub.children) {
            let leafY = subTopY;
            for (const leaf of sub.children) {
              positions[leaf.id] = { x: subX - 270 - 240, y: leafY };
              leafY += 46;
            }
          }
          subTopY += sH;
        }
      }
      leftTopY += gH;
    }
  }

  return positions;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const GROUP_COLORS = [
  { border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8' },
  { border: '#10b981', bg: '#ecfdf5', text: '#047857' },
  { border: '#f59e0b', bg: '#fffbeb', text: '#b45309' },
  { border: '#8b5cf6', bg: '#f5f3ff', text: '#6d28d9' },
  { border: '#06b6d4', bg: '#ecfeff', text: '#0e7490' },
  { border: '#ec4899', bg: '#fdf2f8', text: '#be185d' },
];

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GET:     { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  POST:    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  PUT:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  PATCH:   { bg: '#fdf4ff', text: '#7e22ce', border: '#e9d5ff' },
  DELETE:  { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
  HEAD:    { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' },
  OPTIONS: { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' },
};

function methodStyle(method = 'GET') {
  return METHOD_COLORS[method.toUpperCase()] ?? METHOD_COLORS['GET'];
}

function statusColor(s?: string): string {
  if (s === 'VERIFIED') return '#10b981';
  if (s === 'UNAVAILABLE') return '#f59e0b';
  if (s === 'BLOCKED') return '#ef4444';
  if (s === 'PENDING') return '#6366f1';
  return '#94a3b8';
}

// ─── Main component ───────────────────────────────────────────────────────────

export const EndpointDiscoveryGraph: React.FC = () => {
  const [searchParams] = useSearchParams();
  const urlProjectId = searchParams.get('project');

  // Fetch real projects
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/projects'),
  });

  const [selectedProjectId, setSelectedProjectId] = useState<string>('__demo__');

  // Synchronize URL param if provided and valid
  useEffect(() => {
    if (urlProjectId && projects.some(p => p.id === urlProjectId)) {
      setSelectedProjectId(urlProjectId);
    } else if (projects.length > 0 && selectedProjectId === '__demo__') {
      setSelectedProjectId(projects[0].id);
    }
  }, [urlProjectId, projects, selectedProjectId]);

  const realProject = projects.find(p => p.id === selectedProjectId);

  // Fetch runs for the selected real project
  const { data: runs = [] } = useQuery<DiscoveryRun[]>({
    queryKey: ['discovery-runs', selectedProjectId],
    queryFn: () => apiFetch<DiscoveryRun[]>(`/projects/${selectedProjectId}/discovery?limit=5`),
    enabled: !!realProject,
  });

  const latestCompletedRun = runs.find(r => r.status === 'COMPLETED') ?? runs[0] ?? null;

  // Fetch candidates for latest completed run
  const { data: candidatesData = [] } = useQuery<DiscoveryCandidate[]>({
    queryKey: ['candidates', latestCompletedRun?.id],
    queryFn: () => apiFetch<DiscoveryCandidate[]>(`/discovery/${latestCompletedRun!.id}/candidates?limit=500`),
    enabled: !!latestCompletedRun,
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('All Methods');
  const [selectedStatus, setSelectedStatus] = useState('All Status');
  const [selectedSource, setSelectedSource] = useState('All Sources');

  // Layout mode: 'balanced' (both left & right), 'horizontal' (classic right-only)
  const [layoutMode, setLayoutMode] = useState<'balanced' | 'horizontal'>('balanced');

  // Collapse / Expand tracking
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => {
    setCollapsedNodes(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Zoom & Pan
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 250, y: 150 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Selected node for detail drawer
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [copied, setCopied] = useState(false);

  // Node Positions (Explicit coordinates independent of viewport dimensions)
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>({});

  // Node Dragging State using ref to avoid React state mutation warnings
  const dragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    initialNodeX: number;
    initialNodeY: number;
    hasMoved: boolean;
  } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Tree computation
  const usingDemo = selectedProjectId === '__demo__' || !realProject;
  const rootUrl = realProject?.url ?? 'https://api.example.com';
  
  const tree = useMemo(() => {
    return usingDemo
      ? buildDefaultTree()
      : buildTree(rootUrl, candidatesData, searchQuery, selectedMethod, selectedStatus, selectedSource);
  }, [usingDemo, rootUrl, candidatesData, searchQuery, selectedMethod, selectedStatus, selectedSource]);

  // Collect all visible nodes
  const visibleNodes = useMemo(() => {
    const list: TreeNode[] = [];
    function walk(n: TreeNode) {
      list.push(n);
      if (!collapsedNodes.has(n.id) && n.children) {
        for (const c of n.children) walk(c);
      }
    }
    walk(tree);
    return list;
  }, [tree, collapsedNodes]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  // Edges
  const edges = useMemo(() => {
    const pairs: Array<{ from: string; to: string }> = [];
    function walk(node: TreeNode) {
      if (!node.children?.length) return;
      if (collapsedNodes.has(node.id)) return;
      for (const child of node.children) {
        pairs.push({ from: node.id, to: child.id });
        walk(child);
      }
    }
    walk(tree);
    return pairs;
  }, [tree, collapsedNodes]);

  // Metrics
  const totalEndpoints = usingDemo ? 52 : candidatesData.length;
  const verified = usingDemo ? 48 : candidatesData.filter(c => c.verification_status === 'VERIFIED').length;
  const unverified = usingDemo ? 3 : candidatesData.filter(c => !['VERIFIED', 'BLOCKED'].includes(c.verification_status)).length;
  const blocked = usingDemo ? 1 : candidatesData.filter(c => c.verification_status === 'BLOCKED').length;

  // Persistence helpers
  const savePositions = useCallback((positions: Record<string, Point>) => {
    try {
      localStorage.setItem(`apixplore_graph_positions_${selectedProjectId}`, JSON.stringify(positions));
    } catch (e) {
      console.error('Failed to persist graph positions:', e);
    }
  }, [selectedProjectId]);

  const saveViewport = useCallback((p: Point, z: number) => {
    try {
      localStorage.setItem(`apixplore_graph_viewport_${selectedProjectId}`, JSON.stringify({ pan: p, zoom: z }));
    } catch (e) {
      console.error('Failed to persist graph viewport:', e);
    }
  }, [selectedProjectId]);

  // Fit to view calculation using current node positions
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const entries = Object.entries(nodePositions).filter(([id]) => visibleNodeIds.has(id));
    if (entries.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [id, pos] of entries) {
      const dim = getNodeDimensions(id === 'root' ? 0 : id.startsWith('group-') ? 1 : id.startsWith('sub-') ? 2 : 3);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + dim.w);
      maxY = Math.max(maxY, pos.y + dim.h);
    }

    if (minX === Infinity || maxX === -Infinity) return;

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    const viewportW = containerRef.current.clientWidth || 1200;
    const viewportH = containerRef.current.clientHeight || 700;

    const scaleX = (viewportW - 140) / graphWidth;
    const scaleY = (viewportH - 140) / graphHeight;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.15);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const newPan = {
      x: Math.round(viewportW / 2 - centerX * newZoom),
      y: Math.round(viewportH / 2 - centerY * newZoom),
    };

    setZoom(newZoom);
    setPan(newPan);
    saveViewport(newPan, newZoom);
  }, [nodePositions, visibleNodeIds, saveViewport]);

  // Reset view to default zoom (1.0) and center on root node
  const resetView = useCallback(() => {
    if (!containerRef.current) return;
    const rootPos = nodePositions['root'] || { x: 1400, y: 700 };
    const viewportW = containerRef.current.clientWidth || 1200;
    const viewportH = containerRef.current.clientHeight || 700;
    const newZoom = 1.0;
    const newPan = {
      x: Math.round(viewportW / 2 - (rootPos.x + 140) * newZoom),
      y: Math.round(viewportH / 2 - (rootPos.y + 36) * newZoom),
    };
    setZoom(newZoom);
    setPan(newPan);
    saveViewport(newPan, newZoom);
  }, [nodePositions, saveViewport]);

  // Explicit Auto Layout execution (only when user clicks Auto Layout)
  const handleAutoLayout = useCallback(() => {
    const fresh = computeLayout(tree, collapsedNodes, layoutMode);
    setNodePositions(fresh);
    savePositions(fresh);
    setTimeout(() => {
      // Re-center after auto layout
      if (containerRef.current) {
        const entries = Object.entries(fresh);
        if (entries.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [id, pos] of entries) {
          const dim = getNodeDimensions(id === 'root' ? 0 : id.startsWith('group-') ? 1 : id.startsWith('sub-') ? 2 : 3);
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + dim.w);
          maxY = Math.max(maxY, pos.y + dim.h);
        }
        const vpW = containerRef.current.clientWidth || 1200;
        const vpH = containerRef.current.clientHeight || 700;
        const scaleX = (vpW - 140) / (maxX - minX);
        const scaleY = (vpH - 140) / (maxY - minY);
        const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.15);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const newPan = {
          x: Math.round(vpW / 2 - centerX * newZoom),
          y: Math.round(vpH / 2 - centerY * newZoom),
        };
        setZoom(newZoom);
        setPan(newPan);
        saveViewport(newPan, newZoom);
      }
    }, 40);
  }, [tree, collapsedNodes, layoutMode, savePositions, saveViewport]);

  // Load saved positions & viewport on project switch, or compute initial layout once
  useEffect(() => {
    if (!selectedProjectId) return;

    let loadedPositions: Record<string, Point> | null = null;
    let loadedViewport: { pan: Point; zoom: number } | null = null;

    try {
      const posStr = localStorage.getItem(`apixplore_graph_positions_${selectedProjectId}`);
      if (posStr) loadedPositions = JSON.parse(posStr);
    } catch {
      loadedPositions = null;
    }

    try {
      const vpStr = localStorage.getItem(`apixplore_graph_viewport_${selectedProjectId}`);
      if (vpStr) loadedViewport = JSON.parse(vpStr);
    } catch {
      loadedViewport = null;
    }

    if (loadedPositions && Object.keys(loadedPositions).length > 0) {
      // Restore user-defined positions! Fill in any genuinely new missing nodes without touching existing coordinates.
      const fresh = computeLayout(tree, collapsedNodes, layoutMode);
      const merged = { ...fresh, ...loadedPositions };
      setNodePositions(merged);
      if (loadedViewport) {
        setPan(loadedViewport.pan);
        setZoom(loadedViewport.zoom);
      }
    } else {
      // First load for this project: compute layout once and save
      const initial = computeLayout(tree, collapsedNodes, layoutMode);
      setNodePositions(initial);
      savePositions(initial);
      setTimeout(() => {
        fitToView();
      }, 80);
    }
  }, [selectedProjectId]); // Only run on project change!

  // Incremental node placement: when new nodes arrive, preserve all existing coordinates and only place new nodes
  useEffect(() => {
    setNodePositions(prev => {
      if (Object.keys(prev).length === 0) return prev;
      let hasMissing = false;
      function check(n: TreeNode) {
        if (!prev[n.id]) hasMissing = true;
        n.children?.forEach(check);
      }
      check(tree);

      if (!hasMissing) return prev; // Preserve existing positions completely!

      const fresh = computeLayout(tree, collapsedNodes, layoutMode);
      const next = { ...prev };
      for (const [id, pos] of Object.entries(fresh)) {
        if (!next[id]) {
          next[id] = pos;
        }
      }
      savePositions(next);
      return next;
    });
  }, [tree, collapsedNodes, layoutMode, savePositions]);

  // Mouse pan handling on canvas background
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // If clicking on node or button, do not start canvas pan
    if ((e.target as HTMLElement).closest('.graph-node') || (e.target as HTMLElement).closest('button')) {
      return;
    }
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  // Node Dragging initiation
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return; // Only left click
    const pos = nodePositions[nodeId];
    if (!pos) return;

    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      initialNodeX: pos.x,
      initialNodeY: pos.y,
      hasMoved: false,
    };
    setActiveDragId(nodeId);
  };

  // Global mousemove for both node drag and canvas pan
  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const cur = dragRef.current;
      const dx = (e.clientX - cur.startX) / zoom;
      const dy = (e.clientY - cur.startY) / zoom;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        cur.hasMoved = true;
      }
      setNodePositions(prev => ({
        ...prev,
        [cur.nodeId]: {
          x: Math.round(cur.initialNodeX + dx),
          y: Math.round(cur.initialNodeY + dy),
        },
      }));
      return;
    }

    if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
    }
  };

  // Global mouseup for drag commit and pan commit
  const handleMouseUp = () => {
    if (dragRef.current) {
      if (dragRef.current.hasMoved) {
        savePositions(nodePositions);
      }
      dragRef.current = null;
      setActiveDragId(null);
    }
    if (isPanning) {
      setIsPanning(false);
      saveViewport(pan, zoom);
    }
  };

  // Wheel zoom handling (clamped, prevented from scrolling the page)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => {
      const nz = Math.min(2.5, Math.max(0.2, z - e.deltaY * 0.0012));
      saveViewport(pan, nz);
      return nz;
    });
  };

  const handleZoomIn = () => {
    setZoom(z => {
      const nz = Math.min(Math.round((z + 0.15) * 100) / 100, 2.5);
      saveViewport(pan, nz);
      return nz;
    });
  };

  const handleZoomOut = () => {
    setZoom(z => {
      const nz = Math.max(Math.round((z - 0.15) * 100) / 100, 0.2);
      saveViewport(pan, nz);
      return nz;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // SVG Edge Rendering connecting node coordinates
  function renderEdge(from: string, to: string, idx: number) {
    const src = nodePositions[from];
    const tgt = nodePositions[to];
    if (!src || !tgt) return null;

    const fromDepth = from === 'root' ? 0 : from.startsWith('group-') ? 1 : from.startsWith('sub-') ? 2 : 3;
    const toDepth = to.startsWith('group-') ? 1 : to.startsWith('sub-') ? 2 : 3;

    const srcDim = getNodeDimensions(fromDepth);
    const tgtDim = getNodeDimensions(toDepth);

    let x1: number, y1: number, x2: number, y2: number;

    if (tgt.x >= src.x) {
      x1 = src.x + srcDim.w;
      y1 = src.y + srcDim.h / 2;
      x2 = tgt.x;
      y2 = tgt.y + tgtDim.h / 2;
    } else {
      x1 = src.x;
      y1 = src.y + srcDim.h / 2;
      x2 = tgt.x + tgtDim.w;
      y2 = tgt.y + tgtDim.h / 2;
    }

    const dx = Math.abs(x2 - x1) * 0.45;
    const cp1x = tgt.x >= src.x ? x1 + dx : x1 - dx;
    const cp2x = tgt.x >= src.x ? x2 - dx : x2 + dx;
    const d = `M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;

    const strokeColors = ['#2563eb', '#64748b', '#94a3b8'];
    const stroke = strokeColors[Math.min(toDepth - 1, strokeColors.length - 1)];

    return (
      <path
        key={idx}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={toDepth === 3 ? 1.4 : toDepth === 2 ? 1.8 : 2.2}
        strokeOpacity={toDepth === 3 ? 0.5 : toDepth === 2 ? 0.7 : 0.85}
        markerEnd={tgt.x >= src.x ? `url(#arrow-right-${toDepth})` : `url(#arrow-left-${toDepth})`}
      />
    );
  }

  // Render individual node element at its coordinate
  function renderNode(node: TreeNode, groupIdx = 0): React.ReactNode {
    const isCollapsed = collapsedNodes.has(node.id);
    const gc = GROUP_COLORS[groupIdx % GROUP_COLORS.length];
    const isLeaf = node.depth === 3;
    const pos = nodePositions[node.id];
    if (!pos) return null;

    const isDraggingThis = activeDragId === node.id;

    if (isLeaf) {
      const ms = methodStyle(node.method);
      return (
        <div
          key={node.id}
          className="graph-node select-none"
          style={{
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            zIndex: isDraggingThis ? 40 : 10,
            cursor: isDraggingThis ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          onClick={() => {
            if (!dragRef.current?.hasMoved) setSelectedNode(node);
          }}
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl border hover:shadow-md transition-shadow shadow-xs"
            style={{
              borderColor: statusColor(node.verificationStatus),
              boxShadow: selectedNode?.id === node.id ? `0 0 0 2px ${statusColor(node.verificationStatus)}` : undefined,
              width: 240,
            }}
          >
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border flex-shrink-0"
              style={{ background: ms.bg, color: ms.text, borderColor: ms.border }}
            >
              {node.method ?? 'GET'}
            </span>
            <span className="font-mono text-[11px] text-slate-700 truncate flex-1">{node.label}</span>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: statusColor(node.verificationStatus) }}
              title={node.verificationStatus}
            />
          </div>
        </div>
      );
    }

    if (node.depth === 0) {
      return (
        <div
          key={node.id}
          className="graph-node select-none"
          style={{
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            zIndex: isDraggingThis ? 50 : 25,
            cursor: isDraggingThis ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          onClick={() => {
            if (!dragRef.current?.hasMoved) setSelectedNode(node);
          }}
        >
          <div
            className="flex items-center gap-3 px-5 py-3.5 bg-white rounded-2xl border-2 shadow-lg hover:shadow-xl transition-shadow"
            style={{ borderColor: '#2563eb', width: 280 }}
          >
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
              <GlobeIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-sm text-slate-900 truncate" title={node.label}>
                {node.label}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  Root Target
                </span>
                <span className="text-[11px] text-slate-500 font-semibold">{node.childCount} endpoints</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (node.depth === 1) {
      return (
        <div
          key={node.id}
          className="graph-node select-none"
          style={{
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            zIndex: isDraggingThis ? 45 : 15,
            cursor: isDraggingThis ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          onClick={() => {
            if (!dragRef.current?.hasMoved) {
              setSelectedNode(node);
            }
          }}
        >
          <div
            className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow"
            style={{ borderColor: gc.border, width: 210 }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: gc.bg, color: gc.text }}>
              <FolderIcon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs text-slate-900 truncate">{node.label}</div>
              <div className="text-[10px] text-slate-500">{node.childCount} endpoints</div>
            </div>
            <button
              type="button"
              className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold transition-colors flex-shrink-0 hover:brightness-95 cursor-pointer"
              style={{ background: gc.bg, borderColor: gc.border, color: gc.text }}
              onClick={e => {
                e.stopPropagation();
                toggleCollapse(node.id);
              }}
              title={isCollapsed ? 'Expand branch' : 'Collapse branch'}
            >
              {isCollapsed ? '+' : '−'}
            </button>
          </div>
        </div>
      );
    }

    if (node.depth === 2) {
      return (
        <div
          key={node.id}
          className="graph-node select-none"
          style={{
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            zIndex: isDraggingThis ? 42 : 12,
            cursor: isDraggingThis ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          onClick={() => {
            if (!dragRef.current?.hasMoved) setSelectedNode(node);
          }}
        >
          <div
            className="flex items-center gap-2.5 px-3 py-2 bg-white rounded-lg border border-slate-200 shadow-xs hover:border-blue-400 hover:shadow-sm transition-shadow"
            style={{ width: 190 }}
          >
            <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <FolderIcon size={12} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-xs text-slate-800 truncate">{node.label}</div>
              <div className="text-[9px] text-slate-500">{node.childCount ?? node.children?.length ?? 0} endpoints</div>
            </div>
            <button
              type="button"
              className="w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0 cursor-pointer"
              onClick={e => {
                e.stopPropagation();
                toggleCollapse(node.id);
              }}
              title={isCollapsed ? 'Expand branch' : 'Collapse branch'}
            >
              {isCollapsed ? '+' : '−'}
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] min-h-[700px] w-full bg-[#f8fafc] rounded-2xl border border-slate-200 shadow-xs overflow-hidden font-sans">
      {/* ── Header: Project Selector & KPIs ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200 gap-3 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-5 bg-blue-600 rounded-full" />
            <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Attack-Surface Discovery Graph
              <span className="text-slate-400 cursor-help" title="Interactive visual topology of discovered API routes and endpoints">
                <InfoIcon size={15} />
              </span>
            </h1>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-w-xs truncate"
            >
              <option value="__demo__">example.com (Demo - 52 Endpoints)</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name || p.url} ({p.endpoint_count} endpoints)
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 ml-4">
            {usingDemo ? 'Viewing demonstration surface topology. Choose an active project above.' : `Active scan for ${rootUrl}`}
          </p>
        </div>

        {/* Status Counters */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto">
          {[
            { label: 'Total', value: totalEndpoints, color: 'blue', Icon: LayersIcon },
            { label: 'Verified', value: verified, color: 'emerald', Icon: CheckCircleIcon },
            { label: 'Unverified', value: unverified, color: 'amber', Icon: ClockIcon },
            { label: 'Blocked', value: blocked, color: 'rose', Icon: BlockedIcon },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-${color}-50/60 border border-${color}-100 flex-shrink-0`}>
              <div className={`w-7 h-7 rounded-lg bg-${color}-500/10 flex items-center justify-center text-${color}-600`}>
                <Icon size={14} />
              </div>
              <div>
                <div className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">{label}</div>
                <div className="text-sm font-bold text-slate-900 leading-tight">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filter & Layout Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between px-6 py-2.5 bg-white border-b border-slate-200 text-xs gap-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[300px]">
          {/* Search box */}
          <div className="relative flex-1 max-w-xs">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search endpoints or paths..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 text-xs"
            />
          </div>

          {/* Filters */}
          <select
            value={selectedMethod}
            onChange={e => setSelectedMethod(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs cursor-pointer focus:outline-none"
          >
            {['All Methods', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(o => <option key={o}>{o}</option>)}
          </select>

          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs cursor-pointer focus:outline-none"
          >
            {['All Status', 'Verified', 'Unavailable', 'Blocked', 'Pending'].map(o => <option key={o}>{o}</option>)}
          </select>

          <select
            value={selectedSource}
            onChange={e => setSelectedSource(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs cursor-pointer focus:outline-none"
          >
            {['All Sources', 'OpenAPI', 'Crawler', 'JavaScript'].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* Layout & View Controls */}
        <div className="flex items-center gap-2">
          {/* Layout Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              onClick={() => setLayoutMode('balanced')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                layoutMode === 'balanced'
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Balanced layout: distributes branches across left and right canvas space"
            >
              Balanced ↔
            </button>
            <button
              onClick={() => setLayoutMode('horizontal')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                layoutMode === 'horizontal'
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Horizontal layout: traditional left-to-right expansion"
            >
              Flow →
            </button>
          </div>

          <button
            onClick={() => setCollapsedNodes(new Set())}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
          >
            Expand All
          </button>
          <button
            onClick={() => {
              const all = new Set<string>();
              function collect(n: TreeNode) { all.add(n.id); n.children?.forEach(collect); }
              collect(tree);
              setCollapsedNodes(all);
            }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
          >
            Collapse All
          </button>

          {/* Auto Layout Action Button */}
          <button
            onClick={handleAutoLayout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer"
            title="Re-run automatic layout algorithm and optimize node positions"
          >
            <GitBranch size={13} className="text-blue-600" /> Auto Layout
          </button>

          {/* Reset View Action Button */}
          <button
            onClick={resetView}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            title="Reset zoom to 100% and center on Root Node"
          >
            <RefreshCw size={12} /> Reset View
          </button>

          {/* Fit to View Action Button */}
          <button
            onClick={fitToView}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            title="Fit all placed nodes nicely into view"
          >
            <MaximizeIcon size={13} /> Fit View
          </button>

          <button
            onClick={() => {
              const data = usingDemo
                ? JSON.stringify(tree, null, 2)
                : JSON.stringify(candidatesData, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${realProject?.name || 'api-surface'}-discovery.json`;
              a.click();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <ExportIcon size={13} /> Export
          </button>
        </div>
      </div>

      {/* ── Main Canvas Viewport ── */}
      <div className="relative flex-1 flex overflow-hidden">
        <div
          ref={containerRef}
          className={`flex-1 relative overflow-hidden bg-[#fcfdfd] select-none ${
            isPanning ? 'cursor-grabbing' : activeDragId ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{
            backgroundImage: 'radial-gradient(circle, #cbd5e1 1.2px, transparent 1.2px)',
            backgroundSize: '24px 24px',
          }}
        >
          {/* Scalable Container holding SVG edges and absolute positioned nodes */}
          <div
            className="absolute origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          >
            {/* SVG Connectors Overlay */}
            <svg
              className="absolute pointer-events-none"
              style={{
                top: 0,
                left: 0,
                width: '6000px',
                height: '4000px',
                overflow: 'visible',
              }}
            >
              <defs>
                {/* Rightward markers */}
                {[1, 2, 3].map(depth => {
                  const colors = ['#2563eb', '#64748b', '#94a3b8'];
                  const col = colors[Math.min(depth - 1, 2)];
                  return (
                    <marker
                      key={`r-${depth}`}
                      id={`arrow-right-${depth}`}
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="3"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M0,0 L0,6 L8,3 z" fill={col} fillOpacity={depth === 3 ? 0.6 : 0.85} />
                    </marker>
                  );
                })}
                {/* Leftward markers */}
                {[1, 2, 3].map(depth => {
                  const colors = ['#2563eb', '#64748b', '#94a3b8'];
                  const col = colors[Math.min(depth - 1, 2)];
                  return (
                    <marker
                      key={`l-${depth}`}
                      id={`arrow-left-${depth}`}
                      markerWidth="8"
                      markerHeight="8"
                      refX="1"
                      refY="3"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M8,0 L8,6 L0,3 z" fill={col} fillOpacity={depth === 3 ? 0.6 : 0.85} />
                    </marker>
                  );
                })}
              </defs>

              {/* Draw Edges */}
              {edges.map((edge, i) => renderEdge(edge.from, edge.to, i))}
            </svg>

            {/* Render Nodes Absolutely */}
            <div className="absolute top-0 left-0">
              {visibleNodes.map((node, i) => renderNode(node, i))}
            </div>
          </div>

          {/* Floating Canvas Quick Controls (Zoom in, Zoom out, Reset, Fit, Auto Layout) */}
          <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-2">
            <div className="flex items-center bg-white rounded-xl border border-slate-200 shadow-md p-1 gap-1">
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 text-sm font-bold cursor-pointer transition-colors"
                title="Zoom In (+)"
              >
                +
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 text-sm font-bold cursor-pointer transition-colors"
                title="Zoom Out (−)"
              >
                −
              </button>
              <button
                type="button"
                onClick={resetView}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                title="Reset View (100% Zoom, Centered on Root)"
              >
                <RefreshCw size={13} />
              </button>
              <button
                type="button"
                onClick={fitToView}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                title="Fit All Nodes into View"
              >
                <MaximizeIcon size={14} />
              </button>
              <div className="h-4 w-px bg-slate-200 mx-0.5" />
              <button
                type="button"
                onClick={handleAutoLayout}
                className="px-2.5 h-8 rounded-lg flex items-center gap-1.5 text-blue-600 hover:bg-blue-50 text-xs font-semibold cursor-pointer transition-colors"
                title="Re-run Auto Layout"
              >
                <GitBranch size={13} /> Layout
              </button>
            </div>
            <div className="text-center text-[10px] text-slate-500 font-semibold bg-white rounded-lg px-2 py-1 border border-slate-200 shadow-xs">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Legend */}
          <div className="absolute bottom-6 right-6 z-20 bg-white rounded-xl border border-slate-200 shadow-md p-3 text-[10px] text-slate-600 hidden sm:block">
            <div className="font-bold text-slate-700 mb-2 uppercase tracking-wider">Health Status</div>
            {[
              { color: '#10b981', label: 'Verified Active' },
              { color: '#f59e0b', label: 'Unavailable / Degraded' },
              { color: '#ef4444', label: 'Blocked / Down' },
              { color: '#6366f1', label: 'Pending Discovery' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 mt-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
            <div className="mt-2 pt-2 border-t border-slate-100 text-slate-400 text-[9px]">
              Drag nodes to customize · Drag canvas to pan · Scroll to zoom
            </div>
          </div>
        </div>

        {/* ── Endpoint Detail Side Drawer ── */}
        {selectedNode && (
          <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl z-30 overflow-y-auto flex-shrink-0 transition-all animate-slide-left">
            <div className="p-5 border-b border-slate-200 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-blue-600 rounded-full" />
                  <h3 className="font-bold text-sm text-slate-900">
                    {selectedNode.depth <= 2 ? 'Route Branch' : 'Endpoint Inspection'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <CloseIcon size={14} />
                </button>
              </div>

              <div className="mt-4">
                {selectedNode.method && (
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-mono font-bold border"
                      style={{ ...methodStyle(selectedNode.method) }}
                    >
                      {selectedNode.method}
                    </span>
                    {selectedNode.verificationStatus === 'VERIFIED' && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <ShieldCheckIcon size={12} /> Verified
                      </span>
                    )}
                    {selectedNode.verificationStatus === 'BLOCKED' && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                        <BlockedIcon size={12} /> Blocked
                      </span>
                    )}
                  </div>
                )}
                <h2 className="text-sm font-bold text-slate-900 font-mono break-all leading-snug">{selectedNode.label}</h2>
                <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                  <span className="font-mono truncate bg-slate-100 px-2 py-0.5 rounded text-[11px] flex-1">
                    {rootUrl}{selectedNode.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${rootUrl}${selectedNode.path}`)}
                    className="p-1 text-slate-400 hover:text-blue-600 flex-shrink-0 rounded hover:bg-slate-100 cursor-pointer"
                    title="Copy full URL"
                  >
                    <CopyIcon size={13} />
                  </button>
                  {copied && <span className="text-[10px] text-blue-600 font-bold">Copied!</span>}
                </div>
              </div>
            </div>

            <div className="p-5 flex-1 flex flex-col gap-5 text-xs">
              {/* Properties Grid */}
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Path', value: selectedNode.path },
                  { label: 'Hierarchy Level', value: `Level ${selectedNode.depth}` },
                  selectedNode.method && { label: 'HTTP Method', value: selectedNode.method },
                  selectedNode.source && { label: 'Discovery Provider', value: selectedNode.source },
                  selectedNode.confidence && { label: 'Confidence Score', value: selectedNode.confidence },
                  selectedNode.verificationStatus && { label: 'Verification State', value: selectedNode.verificationStatus },
                  selectedNode.httpStatus != null && { label: 'Verified Status Code', value: String(selectedNode.httpStatus) },
                  selectedNode.responseTime != null && { label: 'Latency', value: `${selectedNode.responseTime} ms` },
                  !selectedNode.method && { label: 'Total Leaf Endpoints', value: `${selectedNode.childCount ?? selectedNode.children?.length ?? 0}` },
                ].filter(Boolean).map((item: any) => (
                  <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">{item.label}</span>
                    <span className="font-semibold text-slate-800">{item.value}</span>
                  </div>
                ))}
              </div>

              {/* cURL Snippet */}
              {selectedNode.method && (
                <div>
                  <div className="font-bold text-slate-700 mb-1.5 uppercase tracking-wider text-[10px]">Test Command</div>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] font-mono overflow-x-auto select-all">
                    curl -X {selectedNode.method} "{rootUrl}{selectedNode.path}"
                  </pre>
                </div>
              )}

              {/* Candidates inside this group */}
              {selectedNode.candidates && selectedNode.candidates.length > 0 && (
                <div>
                  <div className="font-bold text-slate-800 mb-2">Group Endpoints ({selectedNode.candidates.length})</div>
                  <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                    {selectedNode.candidates.slice(0, 30).map((c, i) => {
                      const ms = methodStyle(c.method);
                      return (
                        <div key={i} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 hover:bg-blue-50/50 transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border flex-shrink-0"
                              style={{ background: ms.bg, color: ms.text, borderColor: ms.border }}
                            >
                              {c.method}
                            </span>
                            <span className="font-mono text-[11px] text-slate-800 truncate">{c.path}</span>
                          </div>
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: statusColor(c.verification_status) }}
                            title={c.verification_status}
                          />
                        </div>
                      );
                    })}
                    {selectedNode.candidates.length > 30 && (
                      <div className="text-center text-[11px] text-slate-400 py-1">+{selectedNode.candidates.length - 30} more endpoints</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

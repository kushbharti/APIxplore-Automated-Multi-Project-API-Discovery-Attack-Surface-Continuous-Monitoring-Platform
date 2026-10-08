export interface Project {
  id: string;
  name: string;
  url: string;
  description: string | null;
  status: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
  health_score: number | null;
  endpoint_count: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryRun {
  id: string;
  project_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  started_at: string | null;
  completed_at: string | null;
  openapi_checked: boolean;
  crawl_checked: boolean;
  js_checked: boolean;
  openapi_found: boolean;
  openapi_url: string | null;
  candidates_total: number;
  candidates_verified: number;
  candidates_unavailable: number;
  candidates_blocked: number;
  error_message: string | null;
  progress_state?: { step: string; timestamp: string; details: any };
  created_at: string;
}

export interface DiscoveryCandidate {
  id: string;
  run_id: string;
  project_id: string;
  method: string;
  path: string;
  full_url: string;
  source: 'OPENAPI' | 'CRAWLER' | 'JAVASCRIPT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  operation_id: string | null;
  summary: string | null;
  tags: string | null;
  verification_status: 'PENDING' | 'VERIFIED' | 'UNAVAILABLE' | 'BLOCKED';
  http_status: number | null;
  response_time_ms: number | null;
  verification_error: string | null;
  accepted: boolean;
  endpoint_id: string | null;
}

export interface Endpoint {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  method: string;
  url: string;
  path: string | null;
  expected_status: number;
  timeout_ms: number;
  check_interval_seconds: number;
  failure_threshold: number;
  latency_threshold_ms: number;
  enabled: boolean;
  health_state: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
  discovery_source: 'MANUAL' | 'OPENAPI' | 'CRAWLER' | 'JAVASCRIPT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  last_checked_at: string | null;
  tags: string | null;
  created_at: string;
}

export interface OverviewStats {
  total_projects: number;
  total_endpoints: number;
  enabled_endpoints: number;
  healthy_endpoints: number;
  degraded_endpoints: number;
  down_endpoints: number;
  unknown_endpoints: number;
  active_incidents: number;
  total_checks_24h: number;
  success_rate_24h: number | null;
  avg_latency_24h: number | null;
}

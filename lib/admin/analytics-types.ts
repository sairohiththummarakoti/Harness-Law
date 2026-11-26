export type AnalyticsRange = 7 | 30 | 90;
export type AdminViewer = { role: 'owner' | 'admin'; email: string };
export type AnalyticsUser = {
  userId: string; provider: string; email: string; displayName: string;
  firstSeen: number; lastSeen: number; country: string | null; region: string | null; city: string | null;
  role: 'owner' | 'admin' | null;
};
export type AnalyticsBreakdown = { label: string; count: number };
export type AnalyticsSession = {
  id: string; userId: string; email: string; displayName: string; provider: string;
  createdAt: number; country: string | null; region: string | null; city: string | null;
  device: string; browser: string;
};
export type AdminOverview = {
  viewer: AdminViewer; days: AnalyticsRange; generatedAt: number; trackingSince: number | null;
  metrics: { totalUsers: number; activeNow: number; activeUsers: number; newUsers: number; sessions: number; pageviews: number };
  trend: { date: string; pageviews: number; sessions: number; activeUsers: number }[];
  locations: { country: string | null; region: string | null; city: string | null; count: number }[];
  pages: AnalyticsBreakdown[]; devices: AnalyticsBreakdown[]; browsers: AnalyticsBreakdown[]; referrers: AnalyticsBreakdown[];
  sessions: AnalyticsSession[];
  users: { items: AnalyticsUser[]; total: number; page: number; pageSize: number };
};

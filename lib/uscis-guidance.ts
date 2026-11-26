// Dates and revisions verified on the official USCIS pages on November 26, 2026.
// The manual's "Current as of" date is distinct from a policy alert's issue date.
export const USCIS_GUIDANCE = {
  version: '2026.11.26.1',
  verifiedAt: '2026-11-26',
  eb1PageUpdatedAt: '2025-01-24',
  manualCurrentAsOf: '2026-11-20',
  reviewedSourceVersions: {
    'eb1-overview': '111ee9b91c1674f015d012cba791141fc1255dd5c91d274e4140ddf44ba34301',
    'eb1a-policy': '30061e1856927dc17f7f586e2b160a46ce8a10379650b7617ceb49fc82bf52d7',
  } as Record<string, string>,
  eb1Url: 'https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1',
  manualUrl: 'https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2',
  updates: [
    {
      id: 'PA-2025-14', date: '2025-08-04', title: 'Athletics-specific guidance',
      scope: 'Applies to athletics-related cases',
      url: 'https://www.uscis.gov/sites/default/files/document/policy-manual-updates/20250804-WomensSports.pdf',
      changes: ['USCIS changed its assessment of athletes it classifies as male who seek to compete in women’s sports, including final merits, continued work, and prospective benefit to the United States. Review the official alert for the specific policy and its application.'],
    },
    {
      id: 'Technical update · 2025-02-26', date: '2025-02-26', title: 'Policy Manual terminology',
      scope: 'Technical update across the Policy Manual',
      url: 'https://www.uscis.gov/policy-manual/volume-6-part-f-chapter-2#updates',
      changes: ['USCIS replaced “noncitizen” with “alien” or other appropriate terms and made related technical edits. This update did not introduce an additional evidence category.'],
    },
    {
      id: 'PA-2024-24', date: '2024-10-02', title: 'Four evidence criteria clarified',
      scope: 'Awards, memberships, media coverage, and exhibitions',
      url: 'https://www.uscis.gov/sites/default/files/document/policy-manual-updates/20241002-ExtraordinaryAbility.pdf',
      changes: [
        'Awards: receipt of a team award can be considered when the applicant is a recipient.',
        'Memberships: past memberships may be considered.',
        'Media coverage: qualifying published material does not also have to establish the value of the person’s work or contributions.',
        'Exhibitions: non-artistic exhibitions require a properly supported comparable-evidence argument rather than meeting the artistic-exhibition criterion directly.',
      ],
    },
  ],
} as const;

export function guidanceDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export const VISA_OPTIONS = [
  { id: 'eb1a', label: 'EB-1A', description: 'Extraordinary ability · green card' },
  { id: 'o1', label: 'O-1', description: 'Extraordinary ability or achievement · temporary work' },
  { id: 'eb2niw', label: 'EB-2 NIW', description: 'National interest waiver · green card' },
  { id: 'eb1b', label: 'EB-1B', description: 'Outstanding professors and researchers' },
  { id: 'eb1c', label: 'EB-1C', description: 'Multinational managers and executives' },
  { id: 'e1', label: 'E-1', description: 'Treaty trader' },
  { id: 'e2', label: 'E-2', description: 'Treaty investor' },
  { id: 'l1', label: 'L-1', description: 'Intracompany transfer' },
  { id: 'tn', label: 'TN', description: 'Canadian and Mexican professionals' },
  { id: 'h1b', label: 'H-1B', description: 'Specialty occupation' },
  { id: 'k1', label: 'K-1', description: 'Fiancé(e) of a U.S. citizen' },
  { id: 'marriage', label: 'Marriage-based green card', description: 'Immigration through your spouse' },
  { id: 'family', label: 'Family-based green card', description: 'Immigration through a qualifying relative' },
  { id: 'perm', label: 'PERM labor certification', description: 'An employer-sponsored immigration step' },
  { id: 'consular', label: 'Consular processing', description: 'Applying for a visa through a U.S. embassy or consulate' },
  { id: 'other', label: 'Another visa or immigration process', description: 'Describe your interest in the final notes' },
  { id: 'unsure', label: 'I’m not sure yet', description: 'Save your background and explore your options' },
] as const;

export type VisaType = typeof VISA_OPTIONS[number]['id'];
export const VISA_IDS = VISA_OPTIONS.map(option => option.id);

export const INTAKE_STEP_LABELS = {
  basics: 'About you', visa: 'Your plans', birth: 'Country of birth',
  citizenships: 'Citizenship', background: 'Your work', criteria: 'Your experience', review: 'Review',
} as const;

export const E1_TREATY_URL = 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/treaty.html';

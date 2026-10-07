export interface ProjectExample {
  slug: string;
  title: string;
  location: string;
  category: string;
  progress: number;
  status: string;
  summary: string;
  commitment: string;
  color: string;
  letter: string;
  milestones: { title: string; state: 'complete' | 'active' | 'upcoming' }[];
  updates: { date: string; title: string; detail: string; response: string }[];
}

export const projectExamples: ProjectExample[] = [
  {
    slug: 'kibera-water-point',
    title: 'Community water point',
    location: 'Kibera, Nairobi',
    category: 'Water & sanitation',
    progress: 68,
    status: 'Community response open',
    summary: 'Repair and reopen a shared water point, with residents reviewing each stage of the work.',
    commitment: 'Repair the pump, restore safe access, and publish the work completed and its cost.',
    color: '#2b7a68',
    letter: 'W',
    milestones: [
      { title: 'Inspect the pump and publish repair plan', state: 'complete' },
      { title: 'Complete repairs and document materials', state: 'active' },
      { title: 'Community review and handover', state: 'upcoming' },
    ],
    updates: [
      { date: '12 Aug · example', title: 'Repair plan shared', detail: 'The team recorded the pump inspection and listed the parts needed for repair.', response: 'A resident asked for the itemized cost of replacement parts.' },
      { date: '19 Aug · example', title: 'Parts installed', detail: 'A sample update shows the replacement handle and seal fitted. A receipt is attached as an example.', response: 'The cost question is still open for the project team to answer.' },
    ],
  },
  {
    slug: 'tamale-market-road',
    title: 'Market access road repair',
    location: 'Tamale, Ghana',
    category: 'Public works',
    progress: 42,
    status: 'Community response open',
    summary: 'Improve drainage and repair the section of road used by market vendors and nearby homes.',
    commitment: 'Clear blocked drainage and repair the marked road section before the rainy season.',
    color: '#bd7047',
    letter: 'R',
    milestones: [
      { title: 'Mark the affected road section', state: 'complete' },
      { title: 'Clear drains and publish work log', state: 'active' },
      { title: 'Inspect repairs with local residents', state: 'upcoming' },
    ],
    updates: [
      { date: '04 Sep · example', title: 'Road section mapped', detail: 'The sample record identifies the stretch of road and the drainage points included in the work.', response: 'A market vendor requested that the footpath remain accessible during repairs.' },
      { date: '11 Sep · example', title: 'Drainage work underway', detail: 'A fictional progress note records debris removal and the planned repair sequence.', response: 'The access question is awaiting a project team response.' },
    ],
  },
  {
    slug: 'kano-learning-space',
    title: 'Learning space renovation',
    location: 'Kano, Nigeria',
    category: 'Education',
    progress: 85,
    status: 'Evidence added',
    summary: 'Make a neighborhood learning space safer and more usable for local students.',
    commitment: 'Repair the roof, improve lighting, and prepare the shared room for local study groups.',
    color: '#6274a8',
    letter: 'L',
    milestones: [
      { title: 'Inspect the room and agree priorities', state: 'complete' },
      { title: 'Repair roof and install lighting', state: 'complete' },
      { title: 'Community walk-through and handover', state: 'active' },
    ],
    updates: [
      { date: '21 Jul · example', title: 'Repair work documented', detail: 'The fictional update includes a materials list and a sample photo attachment label.', response: 'A community member asked when the room will reopen.' },
      { date: '28 Jul · example', title: 'Walk-through planned', detail: 'The project team has listed a proposed date for residents to review the finished space.', response: 'The reopening date is not confirmed in this illustrative record.' },
    ],
  },
];

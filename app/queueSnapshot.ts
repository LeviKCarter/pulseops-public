// Sanitized, fully synthetic copy. The private repo's generated app/queueSnapshot.ts carries live personal data
// (health metrics, job applications, addresses); this public copy keeps the same exported types with invented values.
// scripts/refresh_snapshot.py regenerates the real file locally: never commit its output to this repo.

export type QueueTone = 'success' | 'danger' | 'warning' | 'neutral';
export type QueueRow = { id: string; status: string; step: string; engine: string; finished: string; tone: QueueTone };

export interface FoodTopDeal { restaurant: string; deal: string; price: string; netDiscount: string; discountPercent: string; location: string; validThrough: string; orderSource: string; }
export interface EventTopItem { eventName: string; start: string; whyItMadeTheCut: string; ticketRsvpUrgency: string; calendarAction: string; approvalState: string; }
export interface JobTopItem { applicationTier: string; applyOrder: string; jobTitle: string; employer: string; location: string; status: string; likelihood: string; careerValue: string; nextAction: string; requisitionId?: string; }
export interface JobItem {
  orderNum?: number;
  verificationState?: string;
  domainRelevance?: string;
  qualificationState?: string;
  applicationEligible?: boolean;
  isQualPass?: boolean;
  isTerminal?: boolean;
  applicationTier: string;
  applyOrder: string;
  jobTitle: string;
  employer: string;
  location: string;
  requisitionId?: string;
  salary?: string;
  clearance?: string;
  status: string;
  likelihood?: string;
  careerValue?: string;
  nextAction: string;
  url?: string;
}
export interface JobSnapshotState {
  items: JobItem[];
}

export interface PulseRun {
  startedAt: string;
  completedAt?: string | null;
  mode: 'morning' | 'recap'; // pulse_local.py --mode
  success: boolean;
}

export interface PulseProgression {
  exercise: string;
  action: 'increase' | 'hold' | 'reps';
  lastLoad: number;
  lastReps: number;
  unit: string;
  nextLoad: number;
  step: number;
  targetReps: number;
}

export interface PulseHealth {
  weight?: {
    series: Array<{ d: string; lb: number }>;
    latestLb: number;
    latestDate: string;
    bodyFatPct?: number;
    lbPerWeek?: number;
    trendDays?: number;
    bodyFat?: { series: Array<{ d: string; pct: number }>; latest: number; latestDate: string; perWeek?: number; trendDays?: number } | null;
    muscle?: { series: Array<{ d: string; lb: number }>; latest: number; latestDate: string; perWeek?: number; trendDays?: number } | null;
  } | null;
  nextWorkout?: string | null;
  lastLiftDate?: string | null;
  lastRunDate?: string | null;
  progression?: PulseProgression[];
  steps?: string | null;
  plan?: PulsePlan | null;
  heartRate?: PulseHeartRate | null;
}

// Today's session from the weekly plan (Mon A, Tue easy run, Wed rest, Thu B, Fri easy run, Sat rest, Sun long run).
export interface PulsePlan {
  kind: 'lift' | 'recover' | 'easy' | 'long' | 'rest' | 'done';
  title: string;
  detail: string;
  at?: string;
  session?: string;
  minutes?: number;
  zone?: number;
  hrLow?: number;
  hrHigh?: number;
  action?: 'start' | 'increase' | 'hold' | 'cut';
  // An afternoon lift on a run day: the morning run is the session, and this is the lift after it.
  lift?: { session: string; title: string; at: string };
  week?: Array<{ date: string; dow: string; plan: string }>;
}

// Average heart rate of each lift or run (the watch records none outside workouts), with zones from the highest reading.
export interface PulseHeartRate {
  series: Array<{ d: string; bpm: number; label: string; max: number }>;
  latest: number;
  latestDate: string;
  perWeek?: number;
  trendDays?: number;
  vo2max?: number;
  vo2maxDate?: string;
  maxHr?: number;
  zones?: Array<{ zone: number; low: number; high: number }>;
}

export interface PulseMorningBrief {
  date: string;
  delivered: boolean;
  deliveredAt?: string | null;
  sections?: {
    healthTraining?: string | null;
    weatherPm25?: string | null;
    bestAction?: string | null;
  };
  health?: PulseHealth | null;
  // A written rundown of the RSS feeds: model-written paragraphs, each with the feed items (title/link from the feed) it covers.
  rss?: Array<{ text: string; links: Array<{ title: string; url: string; source?: string }> }>;
}

export interface PulseItem {
  id: string;
  title: string;
  summary: string;
  category?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  surfacedAt: string;
}

export interface PulseDailyRecapSection {
  heading: string;
  items: Array<{
    title: string;
    summary: string;
    url?: string | null;
  }>;
}

export interface PulseDailyRecap {
  date: string;
  generatedAt: string;
  sections: PulseDailyRecapSection[];
}

export interface PulseError {
  occurredAt: string;
  message: string;
}

export interface PulseSnapshot {
  snapshotGeneratedAt?: string;
  generatedAt: string;
  lastSuccessfulPulseRun?: string | null;
  status: 'current' | 'stale' | 'failed' | 'not_run' | 'offline';
  latestRun?: PulseRun | null;
  morningBrief?: PulseMorningBrief | null;
  latestItems: PulseItem[];
  dailyRecap?: PulseDailyRecap | null;
  weather?: string | null;
  weatherProvider?: string | null;
  weatherObservedAt?: string | null;
  airQuality?: string | null;
  aqProvider?: string | null;
  aqObservedAt?: string | null;
  error?: PulseError | null;
}

export interface CollabCardState<T, S = unknown> {
  count: number;
  status: 'live' | 'stale' | 'available' | 'unavailable' | 'current' | 'failed' | 'not_run' | 'offline';
  topItem: T | null;
  items?: unknown[];
  stats: Record<string, number>;
  state?: S;
}

export interface GearItem {
  product: string;
  seller: string;
  price: string;
  stock: string;
  alert: boolean;
  url: string;
  checkedAt: string;
  notes: string;
}

export interface CollabCardsData {
  version: '1' | '2';
  updatedAt: string;
  food: CollabCardState<FoodTopDeal> & { gear?: GearItem[] };
  events: CollabCardState<EventTopItem>;
  jobs: CollabCardState<JobTopItem>;
  pulse: CollabCardState<PulseItem, PulseSnapshot>;
}

export interface ProviderUsageState { status:string; tasksToday:number; tokensToday:number|null; detail:string; resetAt:string; }
export interface SnapshotState { updatedAt:string; updatedLabel:string; running:number; queued:number; activeLeases:number; requestsPending:number; requestsBlank:number; requestsAttention:number; latestFailureId:string; latestFailureDetail:string; systemLabel:string; systemDetail:string; workerId:string; workerStatus:string; workerLabel:string; workerVersion:string; workerLastSeen:string; workerLastSeenLabel:string; sparkGmailHealth:string; diskFree:string; workerNote:string; fleetHealth:string; providerStatus:string; providerUsage:Record<'gemini'|'deepseek'|'claude',ProviderUsageState>; edgeFeedStatus:string; retainedTerminalHistory:number; retainedDone:number; retainedFailed:number; historicalDlq:number; archivedRecords:number; queueAttentionMeta:string; queueAttentionTitle:string; queueAttentionDetail:string; queueAttentionTone:string; requestsAttentionMeta:string; requestsAttentionTitle:string; requestsAttentionDetail:string; requestsAttentionTone:string; eventsAttentionMeta:string; eventsAttentionTitle:string; eventsAttentionDetail:string; eventsAttentionTone:string; foodAttentionMeta:string; foodAttentionTitle:string; foodAttentionDetail:string; foodAttentionTone:string; }

// ---------------------------------------------------------------------------
// Synthetic sample data below. No real names, addresses, employers, salaries,
// health readings, or spreadsheet links appear anywhere in this file.
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T09:00:00.000000-06:00';
const NOW_LABEL = 'Jan 1, 9:00 AM';

export const queueRows: QueueRow[] = [
  { id: 'demo-task-0007', status: 'Done', step: 'completed', engine: 'demo-engine', finished: '8:52:11 AM', tone: 'success' },
  { id: 'demo-task-0006', status: 'Done', step: 'completed', engine: 'demo-engine', finished: '8:41:04 AM', tone: 'success' },
  { id: 'demo-task-0005', status: 'Done', step: 'completed', engine: 'local_deterministic', finished: '8:19:46 AM', tone: 'success' },
  { id: 'demo-task-0004', status: 'Failed', step: 'failed', engine: 'demo-engine', finished: '7:57:36 AM', tone: 'danger' },
  { id: 'demo-task-0003', status: 'Done', step: 'completed', engine: 'demo-engine', finished: '7:34:24 AM', tone: 'success' },
  { id: 'demo-task-0002', status: 'Cancelled', step: 'cancelled: superseded by a later request', engine: 'Python', finished: '7:17:13 AM', tone: 'neutral' },
  { id: 'demo-task-0001', status: 'Done', step: 'completed', engine: 'Python', finished: '7:02:09 AM', tone: 'success' },
];

export const snapshot: SnapshotState = {
  updatedAt: NOW,
  updatedLabel: NOW_LABEL,
  running: 0,
  queued: 0,
  activeLeases: 0,
  requestsPending: 0,
  requestsBlank: 0,
  requestsAttention: 0,
  latestFailureId: 'demo-task-0004',
  latestFailureDetail: 'failed · 7:57:36 AM',
  systemLabel: 'System healthy',
  systemDetail: `Demo worker is idle. 0 running, 0 queued. Snapshot updated ${NOW_LABEL}.`,
  workerId: 'worker-demo',
  workerStatus: 'idle',
  workerLabel: 'Idle & ready',
  workerVersion: '0.0.0-demo',
  workerLastSeen: NOW,
  workerLastSeenLabel: '9:00:00 AM',
  sparkGmailHealth: 'OK',
  diskFree: '128.0G / 256.0G',
  workerNote: 'This is a public preview build with sample data. Fleet: HEALTHY (demo). Model capacity: AVAILABLE (demo).',
  fleetHealth: 'HEALTHY',
  providerStatus: 'OK',
  providerUsage: {
    gemini: { status: 'OK', tasksToday: 4, tokensToday: 12000, detail: 'Sample usage', resetAt: '' },
    deepseek: { status: 'OK', tasksToday: 2, tokensToday: 5400, detail: 'Sample usage', resetAt: '' },
    claude: { status: 'OK', tasksToday: 6, tokensToday: 21000, detail: 'Sample usage', resetAt: '' },
  },
  edgeFeedStatus: 'HEALTHY (demo)',
  retainedTerminalHistory: 42,
  retainedDone: 38,
  retainedFailed: 3,
  historicalDlq: 1,
  archivedRecords: 210,
  queueAttentionMeta: '0 attention',
  queueAttentionTitle: 'Queue clear',
  queueAttentionDetail: 'Nothing needs a look right now (demo data).',
  queueAttentionTone: 'success',
  requestsAttentionMeta: '0 attention',
  requestsAttentionTitle: 'Requests clear',
  requestsAttentionDetail: 'Nothing pending (demo data).',
  requestsAttentionTone: 'success',
  eventsAttentionMeta: '0 attention',
  eventsAttentionTitle: 'Events clear',
  eventsAttentionDetail: 'Nothing needs a look (demo data).',
  eventsAttentionTone: 'success',
  foodAttentionMeta: '0 attention',
  foodAttentionTitle: 'Food deals clear',
  foodAttentionDetail: 'Nothing needs a look (demo data).',
  foodAttentionTone: 'success',
};

export const collabCards: CollabCardsData = {
  version: '2',
  updatedAt: NOW,
  food: {
    count: 3,
    status: 'available',
    topItem: {
      restaurant: 'Example Diner (Sample District)',
      deal: 'Sample lunch combo: entree, side, and a drink',
      price: '$8.00',
      netDiscount: '',
      discountPercent: '',
      location: '100 Sample St, Example City, CO 80000',
      validThrough: 'Through the end of the demo period',
      orderSource: 'https://example.com/sample-deal',
    },
    items: [
      {
        kind: 'verified',
        restaurant: 'Example Diner (Sample District)',
        deal: 'Sample lunch combo: entree, side, and a drink',
        price: '$8.00',
        discount: '',
        location: '100 Sample St, Example City, CO 80000',
        validThrough: 'Through the end of the demo period',
        orderSource: 'https://example.com/sample-deal',
        svc: ['pickup'],
        type: 'Sandwiches & salads',
      },
      {
        kind: 'verified',
        restaurant: 'Sample Cafe (Downtown)',
        deal: 'New-app-user welcome offer: free sample item with first purchase',
        price: '$1+ qualifying first purchase',
        discount: '',
        location: '200 Placeholder Ave, Example City, CO 80000',
        validThrough: 'Through the end of the demo period',
        orderSource: 'https://example.com/another-sample-deal',
        svc: ['pickup', 'app'],
        type: 'Coffee & snacks',
      },
      {
        kind: 'recurring',
        restaurant: 'Demo Smoothie Bar',
        deal: 'Rewards members: free smoothie with a qualifying purchase',
        price: '$0 with qualifying purchase',
        discount: '',
        location: '300 Fixture Blvd, Example City, CO 80000',
        validThrough: 'Recurring weekly offer',
        orderSource: 'https://example.com/recurring-sample-deal',
        svc: ['app'],
        type: 'Sandwiches & salads',
      },
    ],
    gear: [
      {
        product: 'Sample Portable Widget 3000',
        seller: 'Demo Seller Co',
        price: '$399.99',
        stock: 'IN STOCK',
        alert: false,
        url: 'https://example.com/sample-product',
        checkedAt: NOW,
        notes: 'Sample gear-watch entry for the public preview.',
      },
      {
        product: 'Sample Portable Widget 3000',
        seller: 'Another Demo Seller',
        price: '$429.99',
        stock: 'SOLD OUT',
        alert: false,
        url: 'https://example.com/sample-product-2',
        checkedAt: NOW,
        notes: 'Sample gear-watch entry for the public preview.',
      },
    ],
    stats: { candidateBacklog: 0, verified: 1, rejected: 0, missingReview: 0, liveVerified: 2, liveRecurring: 1, expiredHistory: 4 },
  },
  events: {
    count: 3,
    status: 'available',
    topItem: null,
    items: [
      {
        eventName: 'Sample Colloquium: Demonstration Talk Series',
        start: '2026-01-02 12:20 PM',
        venue: 'Example Hall, Room 101',
        group: 'Sample Group',
        address: 'Example University, Example City, CO 80000',
        end: '2026-01-02 01:20 PM',
        sourceUrl: 'https://example.com/sample-calendar',
        category: 'Sample Category',
        price: 'Free',
        rsvp: 'Not required',
        urgency: 'Medium',
        disposition: 'Calendar Candidate',
      },
      {
        eventName: 'Demo Workshop: Fixture Building 101',
        start: '2026-01-03 02:00 PM',
        venue: 'Sample Library, lower level',
        group: 'Sample Group',
        address: 'Example University, Example City, CO 80000',
        end: '2026-01-03 04:00 PM',
        sourceUrl: 'https://example.com/sample-calendar',
        category: 'Sample Category',
        price: 'Free',
        rsvp: 'RSVP requested',
        urgency: 'Low',
        disposition: 'Calendar Candidate',
      },
      {
        eventName: 'Sample Seminar: Public Preview Edition',
        start: '2026-01-04 11:15 AM',
        venue: 'Demo Engineering Center',
        group: 'Sample Group',
        address: 'Example University, Example City, CO 80000',
        end: '2026-01-04 12:15 PM',
        sourceUrl: 'https://example.com/sample-calendar',
        category: 'Sample Category',
        price: 'Free',
        rsvp: 'Not required',
        urgency: 'Medium',
        disposition: 'Calendar Candidate',
      },
    ],
    stats: { next24: 1, next7: 3, upcoming: 3, proposalsPending: 0, calendarCandidates: 3, watch: 0 },
  },
  jobs: {
    count: 3,
    status: 'available',
    topItem: {
      applicationTier: 'Tier 1',
      applyOrder: '1',
      jobTitle: 'Sample Research Coordinator',
      employer: 'Example Organization',
      location: 'Example City, CO',
      status: 'Verified Live',
      likelihood: 'High',
      careerValue: 'High',
      nextAction: 'Submit Application (Sample)',
      requisitionId: 'DEMO-0001',
    },
    items: [
      {
        applyOrder: '1',
        jobTitle: 'Sample Research Coordinator',
        employer: 'Example Organization',
        location: 'Example City, CO',
        applicationTier: 'Tier 1',
        status: 'Verified Live',
        likelihood: 'High',
        nextAction: 'Submit Application (Sample)',
        salary: '$50,000 - $55,000',
        requisitionId: 'DEMO-0001',
        fitScore: '90',
        deadline: 'Rolling',
        url: 'https://example.com/sample-job-1',
      },
      {
        applyOrder: '2',
        jobTitle: 'Sample Laboratory Specialist',
        employer: 'Demo Institute',
        location: 'Example City, CO',
        applicationTier: 'Tier 1',
        status: 'Verified Live',
        likelihood: 'Medium',
        nextAction: 'Review posting',
        salary: '$48,000 - $60,000',
        requisitionId: 'DEMO-0002',
        fitScore: '82',
        deadline: 'Rolling',
        url: 'https://example.com/sample-job-2',
      },
      {
        applyOrder: '3',
        jobTitle: 'Sample Affairs Specialist',
        employer: 'Fixture University',
        location: 'Example City, CO',
        applicationTier: 'Tier 2',
        status: 'Verified Live',
        likelihood: 'Medium',
        nextAction: 'Awaiting response',
        salary: '$52,000 - $58,000',
        requisitionId: 'DEMO-0003',
        fitScore: '76',
        deadline: 'Rolling',
        url: 'https://example.com/sample-job-3',
      },
    ],
    stats: { candidateBacklog: 0, verified: 3, rejected: 0, missingReview: 0, liveVerified: 3, liveRecurring: 0, expiredHistory: 0 },
  },
  pulse: {
    count: 3,
    status: 'current',
    topItem: {
      id: 'pulse-demo-01',
      title: 'Sample headline: this is placeholder text for the public preview',
      summary: 'This preview build ships fully synthetic sample data in place of the live personal feed.',
      category: 'Sample',
      url: 'https://example.com/sample-headline',
      publishedAt: NOW,
      surfacedAt: NOW,
    },
    items: [
      { id: 'demo-rss-1', title: 'Sample science headline for the public preview', url: 'https://example.com/sample-1', category: 'Science', source: 'demo-rss', publishedAt: NOW, summary: 'Placeholder summary text describing a sample science story for the public preview build.' },
      { id: 'demo-rss-2', title: 'Sample technology headline for the public preview', url: 'https://example.com/sample-2', category: 'Tech', source: 'demo-rss', publishedAt: NOW, summary: 'Placeholder summary text describing a sample technology story for the public preview build.' },
      { id: 'demo-rss-3', title: 'Sample local headline for the public preview', url: 'https://example.com/sample-3', category: 'Local', source: 'demo-rss', publishedAt: NOW, summary: 'Placeholder summary text describing a sample local story for the public preview build.' },
    ],
    stats: { itemsCount: 3, morningDelivered: 1, dailyRecapAvailable: 1 },
    state: {
      generatedAt: NOW,
      snapshotGeneratedAt: NOW,
      lastSuccessfulPulseRun: NOW,
      status: 'current',
      latestRun: { startedAt: NOW, completedAt: NOW, mode: 'recap', success: true },
      morningBrief: {
        date: '2026-01-01',
        delivered: true,
        deliveredAt: NOW,
        sections: {
          healthTraining: 'Sample training note: placeholder workout summary for the public preview build.',
          weatherPm25: 'Sample weather note: 70°F, mostly clear (placeholder data).',
          bestAction: 'Sample recommended action for the public preview.',
        },
        health: {
          weight: {
            series: [
              { d: '2026-01-01', lb: 180.0 },
              { d: '2025-12-25', lb: 180.5 },
              { d: '2025-12-18', lb: 181.0 },
            ],
            latestLb: 180.0,
            latestDate: '2026-01-01',
            bodyFatPct: 20.0,
            lbPerWeek: -0.5,
            trendDays: 21,
            bodyFat: null,
            muscle: null,
          },
          nextWorkout: 'Sample Workout A',
          lastLiftDate: '2025-12-30',
          progression: [
            { exercise: 'Sample Squat', action: 'increase', lastLoad: 100, lastReps: 8, unit: 'lb', nextLoad: 105, step: 5, targetReps: 8 },
            { exercise: 'Sample Bench Press', action: 'hold', lastLoad: 80, lastReps: 8, unit: 'lb', nextLoad: 80, step: 5, targetReps: 10 },
          ],
          steps: '5,000 (sample)',
        },
      },
      latestItems: [
        { id: 'demo-rss-1', title: 'Sample science headline for the public preview', url: 'https://example.com/sample-1', category: 'Science', source: 'demo-rss', publishedAt: NOW, surfacedAt: NOW } as unknown as PulseItem,
      ],
      dailyRecap: {
        date: '2026-01-01',
        generatedAt: NOW,
        sections: [
          {
            heading: 'Sample section',
            items: [
              { title: 'Sample recap item', summary: 'Placeholder recap summary for the public preview build.', url: 'https://example.com/sample-recap' },
            ],
          },
        ],
      },
      weather: 'Sample: 70°F, mostly clear',
      weatherProvider: 'demo-provider',
      weatherObservedAt: NOW,
      airQuality: 'Sample AQI 40',
      aqProvider: 'demo-provider',
      aqObservedAt: NOW,
      error: null,
    },
  },
};

// Application stages for the Science jobs cards. Shared by the page and the /api/job-stages route so both agree on
// what a valid stage is.

// Where an application stands, in pipeline order. `passed` is the dead end (rejected or not pursuing).
export const JOB_STAGES = [
  { id: 'saved', label: 'Saved', on: 'bg-[#8eabd2]/15 text-[#8db8ee]' },
  { id: 'applied', label: 'Applied', on: 'bg-[#3b3018] text-[#f0cb6d]' },
  { id: 'interviewing', label: 'Interviewing', on: 'bg-[#2c2140] text-[#c9a7f0]' },
  { id: 'offer', label: 'Offer', on: 'bg-[#163426] text-[#8de0ad]' },
  { id: 'passed', label: 'Passed', on: 'bg-[#3b211b] text-[#ff9d7e]' },
] as const;
export type JobStageId = (typeof JOB_STAGES)[number]['id'];
export const isJobStageId = (v: unknown): v is JobStageId => JOB_STAGES.some((s) => s.id === v);

// One role's stage, as the local server keeps it.
export interface JobStageEntry { stage: JobStageId; at: string }

// Keyed by employer + requisition (or title) rather than list position, so a stage keeps matching its role as the feed
// refreshes and reorders.
export const jobKey = (role: { employer: string; requisitionId?: string; jobTitle: string }) =>
  `${role.employer}|${role.requisitionId || role.jobTitle}`.toLowerCase();

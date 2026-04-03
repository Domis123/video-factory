import { supabaseAdmin } from '../config/supabase.js';
import type { JobStatus, Job, JobEvent } from '../types/database.js';

// ── State Machine ──

export const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  idle:            ['idea_seed'],
  idea_seed:       ['planning'],
  planning:        ['brief_review', 'failed'],
  brief_review:    ['queued', 'planning'],           // approve or reject
  queued:          ['clip_prep'],
  clip_prep:       ['transcription', 'failed'],
  transcription:   ['rendering', 'failed'],
  rendering:       ['audio_mix', 'failed'],
  audio_mix:       ['sync_check', 'failed'],
  sync_check:      ['platform_export', 'audio_mix'], // pass or auto-retry
  platform_export: ['auto_qa', 'failed'],
  auto_qa:         ['human_qa', 'failed'],
  human_qa:        ['delivered', 'queued', 'planning'], // approve, re-render, re-plan
  delivered:       [],
  failed:          ['planning'],                     // manual retry
};

export class TransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = 'TransitionError';
  }
}

export class TransitionConflictError extends Error {
  constructor(jobId: string, expectedStatus: JobStatus) {
    super(`Job ${jobId} is no longer in status "${expectedStatus}" (race condition)`);
    this.name = 'TransitionConflictError';
  }
}

// ── Core Functions ──

export async function transitionJob(
  jobId: string,
  fromStatus: JobStatus,
  toStatus: JobStatus,
  details?: Record<string, unknown>,
): Promise<Job> {
  // Validate transition
  if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    throw new TransitionError(fromStatus, toStatus);
  }

  // Atomic update — only succeeds if job is still in fromStatus
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .update({ status: toStatus })
    .eq('id', jobId)
    .eq('status', fromStatus)
    .select()
    .single();

  if (error || !data) {
    throw new TransitionConflictError(jobId, fromStatus);
  }

  // Log event
  await logEvent(jobId, 'state_transition', {
    from_status: fromStatus,
    to_status: toStatus,
    ...details,
  });

  return data as Job;
}

export async function logEvent(
  jobId: string,
  eventType: JobEvent['event_type'],
  details?: Record<string, unknown>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    job_id: jobId,
    event_type: eventType,
    to_status: details?.to_status ?? null,
    from_status: details?.from_status ?? null,
    details: details ?? null,
  };

  const { error } = await supabaseAdmin.from('job_events').insert(payload);
  if (error) {
    console.error(`Failed to log event for job ${jobId}:`, error.message);
  }
}

export async function claimJob(
  jobId: string,
  fromStatus: JobStatus,
  toStatus: JobStatus,
  workerId: string,
): Promise<Job> {
  // Validate transition
  if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    throw new TransitionError(fromStatus, toStatus);
  }

  const { data, error } = await supabaseAdmin
    .from('jobs')
    .update({
      status: toStatus,
      render_worker_id: workerId,
      render_started_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', fromStatus)
    .select()
    .single();

  if (error || !data) {
    throw new TransitionConflictError(jobId, fromStatus);
  }

  await logEvent(jobId, 'state_transition', {
    from_status: fromStatus,
    to_status: toStatus,
    worker_id: workerId,
  });

  return data as Job;
}

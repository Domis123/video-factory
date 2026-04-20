import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CHECKPOINT_DIR =
  process.env.BACKFILL_CHECKPOINT_DIR ?? '/home/video-factory/.backfill-checkpoints';

export type CheckpointStatus = 'in-progress' | 'complete' | 'failed';

export interface R2Operations {
  clips_uploaded: string[];
  keyframes_uploaded: string[];
  old_clips_deleted: string[];
  old_keyframes_deleted: string[];
}

export interface DbOperations {
  old_rows_deleted: number;
  new_rows_inserted: number;
}

export interface Checkpoint {
  parent_asset_id: string;
  brand_id: string;
  started_at: string;
  completed_at: string | null;
  status: CheckpointStatus;
  v2_segment_count: number;
  r2_operations: R2Operations;
  db_operations: DbOperations;
  error: string | null;
  wall_time_ms: number | null;
}

export function emptyR2Operations(): R2Operations {
  return {
    clips_uploaded: [],
    keyframes_uploaded: [],
    old_clips_deleted: [],
    old_keyframes_deleted: [],
  };
}

export function emptyDbOperations(): DbOperations {
  return { old_rows_deleted: 0, new_rows_inserted: 0 };
}

function checkpointPath(dir: string, parentAssetId: string): string {
  return join(dir, `${parentAssetId}.json`);
}

export async function writeCheckpoint(dir: string, cp: Checkpoint): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = checkpointPath(dir, cp.parent_asset_id);
  await writeFile(path, JSON.stringify(cp, null, 2));
}

export async function readCheckpoint(
  dir: string,
  parentAssetId: string,
): Promise<Checkpoint | null> {
  const path = checkpointPath(dir, parentAssetId);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as Checkpoint;
}

export async function listCheckpoints(dir: string): Promise<Checkpoint[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const out: Checkpoint[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const raw = await readFile(join(dir, name), 'utf-8');
    try {
      out.push(JSON.parse(raw) as Checkpoint);
    } catch {
      console.warn(`[checkpoints] Skipping malformed checkpoint ${name}`);
    }
  }
  return out;
}

export function newCheckpoint(parentAssetId: string, brandId: string): Checkpoint {
  return {
    parent_asset_id: parentAssetId,
    brand_id: brandId,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'in-progress',
    v2_segment_count: 0,
    r2_operations: emptyR2Operations(),
    db_operations: emptyDbOperations(),
    error: null,
    wall_time_ms: null,
  };
}

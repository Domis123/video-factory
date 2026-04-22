import { z } from 'zod';
import {
  FORM_ID_VALUES,
  POSTURE_VALUES,
} from './content-forms.js';

export const BrandPersonaSchema = z.object({
  brand_id: z.string().min(1),
  brand_name: z.string().min(1),
  schema_version: z.literal(1),
  status: z.enum(['active', 'draft', 'archived']),
  audience: z.object({
    primary: z.string().min(1),
    psychographic: z.string().min(1),
  }),
  form_posture_allowlist: z.record(
    z.enum(FORM_ID_VALUES),
    z.array(z.enum(POSTURE_VALUES)),
  ),
  content_pillars: z.array(z.string().min(1)),
  allowed_color_treatments: z.array(z.string().min(1)),
  preferred_music_intents: z.array(z.string().min(1)),
  avoid_music_intents: z.array(z.string().min(1)),
  // Will be widened to `VoiceConfig | null` at W10. Keep as null-only until then per W2 Decision 3.
  voice_config: z.null(),
});

export type BrandPersonaFrontmatter = z.infer<typeof BrandPersonaSchema>;

export interface BrandPersona extends BrandPersonaFrontmatter {
  prose_body: string;
}

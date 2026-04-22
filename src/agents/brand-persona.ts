import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  BrandPersonaSchema,
  type BrandPersona,
} from '../types/brand-persona.js';

const PERSONA_DIR = path.join(process.cwd(), 'docs', 'brand-personas');

const cache = new Map<string, BrandPersona>();

export async function loadBrandPersona(brandId: string): Promise<BrandPersona> {
  const cached = cache.get(brandId);
  if (cached) return cached;

  const filePath = path.join(PERSONA_DIR, `${brandId}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'ENOENT'
    ) {
      throw new Error(`BrandPersona not found: ${filePath}`);
    }
    throw err;
  }

  const { frontmatter, body } = splitFrontmatter(raw, filePath);
  const parsed = BrandPersonaSchema.parse(parseYaml(frontmatter));
  const persona: BrandPersona = {
    ...parsed,
    prose_body: body,
  };

  cache.set(brandId, persona);
  return persona;
}

function splitFrontmatter(
  raw: string,
  filePath: string,
): { frontmatter: string; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      `BrandPersona file malformed: missing YAML frontmatter (${filePath})`,
    );
  }
  return {
    frontmatter: match[1],
    body: match[2].replace(/^\s+/, ''),
  };
}

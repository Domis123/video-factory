import {
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  AutoTokenizer,
  AutoProcessor,
  RawImage,
} from '@xenova/transformers';
import sharp from 'sharp';

export class ClipModelLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ClipModelLoadError';
    this.cause = cause;
  }
}

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

// Singleton model instances — first call downloads (~150MB), subsequent calls reuse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let visionModel: any = null;

async function getTextModels() {
  if (!tokenizer || !textModel) {
    try {
      [tokenizer, textModel] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
      ]);
    } catch (err) {
      throw new ClipModelLoadError(
        `Failed to load CLIP text model (${MODEL_ID}). Is the model cached or downloadable?`,
        err,
      );
    }
  }
  return { tokenizer, textModel };
}

async function getVisionModels() {
  if (!processor || !visionModel) {
    try {
      [processor, visionModel] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID),
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID),
      ]);
    } catch (err) {
      throw new ClipModelLoadError(
        `Failed to load CLIP vision model (${MODEL_ID}). Is the model cached or downloadable?`,
        err,
      );
    }
  }
  return { processor, visionModel };
}

function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Embed an image buffer (any format sharp can read) into a 512-dim CLIP vector.
 * The image is resized to 224×224 RGB before processing.
 */
export async function embedImage(buffer: Buffer): Promise<number[]> {
  const { processor: proc, visionModel: model } = await getVisionModels();

  // Resize to 224×224 RGB via Sharp, then build a RawImage for transformers.js
  const { data, info } = await sharp(buffer)
    .resize(224, 224, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rawImage = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
  const imageInputs = await proc(rawImage);
  const { image_embeds } = await model(imageInputs);
  const embedding: number[] = Array.from(image_embeds.data as Float32Array).slice(0, 512);
  return l2Normalize(embedding);
}

/**
 * Embed a text string into a 512-dim CLIP vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const { tokenizer: tok, textModel: model } = await getTextModels();
  const textInputs = tok([text], { padding: true, truncation: true });
  const { text_embeds } = await model(textInputs);
  const embedding: number[] = Array.from(text_embeds.data as Float32Array).slice(0, 512);
  return l2Normalize(embedding);
}

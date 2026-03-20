import { z } from 'zod';

export function isValidAssetUrl(value: string) {
  if (value.startsWith('/')) return true;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const assetUrlSchema = z.string().refine(isValidAssetUrl, 'Enter a valid URL');
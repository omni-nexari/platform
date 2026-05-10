// Type augmentation so renderer TypeScript sees window.nexari
import type { NexariApi } from './preload.js';

declare global {
  interface Window {
    nexari: NexariApi;
  }
}

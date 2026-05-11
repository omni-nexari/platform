/**
 * BullMQ worker — media-processing queue.
 *
 * Consumes jobs enqueued by the upload handler; runs the same
 * `processContentMedia()` pipeline that the inline fallback uses.
 *
 * Concurrency = 2 to leave Pi cores for the API + OS.
 */

import { Worker, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { processContentMedia } from '../services/media-processing.js';
import { QUEUE_NAMES } from '../queues/index.js';

export interface MediaProcessingJobData {
  contentId: string;
  transcode?: boolean;
}

export function startMediaProcessingWorker(connection: Redis): Worker<MediaProcessingJobData> {
  const worker = new Worker<MediaProcessingJobData>(
    QUEUE_NAMES.mediaProcessing,
    async (job) => {
      await processContentMedia(job.data.contentId, { transcode: job.data.transcode === true });
    },
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: 2,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[media-processing] job ${job?.id} failed:`, err.message);
  });

  return worker;
}

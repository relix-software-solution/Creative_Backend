import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ScansService } from '../../scans/scans.service';
import { QUEUE_NAMES } from '../queue.constants';

type ScanProcessJob = {
  scanEventRawId: string;
};

@Processor(QUEUE_NAMES.SCAN_PROCESSING)
export class ScanProcessingProcessor extends WorkerHost {
  constructor(private readonly scansService: ScansService) {
    super();
  }

  async process(job: Job<ScanProcessJob>) {
    await job.updateProgress(10);
    const result = await this.scansService.processRawScan(job.data.scanEventRawId);
    await job.updateProgress(100);

    return result;
  }
}

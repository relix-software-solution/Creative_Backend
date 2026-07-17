import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ImportsService } from '../../imports/imports.service';
import { QUEUE_NAMES } from '../queue.constants';

type ImportProcessJob = {
  importJobId: string;
};

@Processor(QUEUE_NAMES.IMPORT_PROCESSING)
export class ImportProcessingProcessor extends WorkerHost {
  constructor(private readonly importsService: ImportsService) {
    super();
  }

  async process(job: Job<ImportProcessJob>) {
    await job.updateProgress(5);
    const importJob = await this.importsService.processImportJob(
      job.data.importJobId,
    );
    await job.updateProgress(100);

    return {
      importJobId: importJob.id,
      status: importJob.status,
      processedRows: importJob.processedRows,
      successRows: importJob.successRows,
      failedRows: importJob.failedRows,
      duplicateRows: importJob.duplicateRows,
    };
  }
}

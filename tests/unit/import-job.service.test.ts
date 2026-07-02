import { ImportJobService } from '../../src/report-import/services/import-job.service';

describe('ImportJobService helpers', () => {
  it('exposes failStaleActiveJobs', () => {
    expect(typeof ImportJobService.prototype.failStaleActiveJobs).toBe('function');
  });
});

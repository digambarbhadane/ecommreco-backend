import {
  buildSlotRowDeletionFilter,
  shouldRetireEntireUpload,
} from '../../src/report-import/utils/slot-upload-replacement.util';

describe('slot-upload-replacement.util', () => {
  describe('buildSlotRowDeletionFilter', () => {
    it('scopes Amazon B2C replacement to b2c rows only', () => {
      expect(
        buildSlotRowDeletionFilter({
          marketplace: 'amazon',
          slot: 'mtrB2cFile',
          uploadId: 'upload-a',
          uploadSlots: ['mtrB2cFile'],
        }),
      ).toEqual({
        uploadId: 'upload-a',
        amazonMtrSource: 'b2c',
      });
    });

    it('scopes Amazon B2B replacement to b2b rows only', () => {
      expect(
        buildSlotRowDeletionFilter({
          marketplace: 'amazon',
          slot: 'mtrB2bFile',
          uploadId: 'upload-b',
          uploadSlots: ['mtrB2bFile', 'mtrB2cFile'],
        }),
      ).toEqual({
        uploadId: 'upload-b',
        amazonMtrSource: 'b2b',
      });
    });
  });

  describe('shouldRetireEntireUpload', () => {
    it('retires uploads that only contained the replaced slot', () => {
      expect(shouldRetireEntireUpload(['mtrB2cFile'], 'mtrB2cFile')).toBe(true);
      expect(
        shouldRetireEntireUpload(['mtrB2cFile', 'mtrB2bFile'], 'mtrB2bFile'),
      ).toBe(false);
    });
  });
});

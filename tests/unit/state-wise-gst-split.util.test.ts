import {
  aggregateStateWiseRows,
  getRowTotalGstAmount,
  sellerStateKeysFromRegistration,
  splitGstForStateWiseRow,
} from '../../src/report-import/utils/state-wise-gst-split.util';

describe('state-wise-gst-split.util', () => {
  const gujaratSeller = sellerStateKeysFromRegistration('Gujarat', '24AAAAA0000A1Z5');
  const delhiSeller = sellerStateKeysFromRegistration('Delhi', '07AAAAA0000A1Z5');
  const maharashtraSeller = sellerStateKeysFromRegistration(
    'Maharashtra',
    '27AAAAA0000A1Z5',
  );

  const baseRow = {
    igstRate: 18,
    igstAmount: 180,
    cgstAmount: 0,
    sgstAmount: 0,
    taxableAmount: 1000,
    invoiceAmount: 1180,
    quantity: 1,
  };

  describe('getRowTotalGstAmount', () => {
    it('uses IGST when only IGST is populated', () => {
      expect(getRowTotalGstAmount({ igstAmount: 180 })).toBe(180);
    });

    it('uses CGST+SGST when only those are populated', () => {
      expect(
        getRowTotalGstAmount({ cgstAmount: 90, sgstAmount: 90 }),
      ).toBe(180);
    });

    it('does not double-count when both IGST and CGST/SGST exist', () => {
      expect(
        getRowTotalGstAmount({
          igstAmount: 180,
          cgstAmount: 90,
          sgstAmount: 90,
        }),
      ).toBe(180);
    });
  });

  describe('splitGstForStateWiseRow', () => {
    it('Seller Gujarat + Order Gujarat => CGST + SGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Gujarat' },
        gujaratSeller,
      );
      expect(tax).toEqual({ igst: 0, cgst: 90, sgst: 90 });
    });

    it('Seller Gujarat + Order Maharashtra => IGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Maharashtra' },
        gujaratSeller,
      );
      expect(tax).toEqual({ igst: 180, cgst: 0, sgst: 0 });
    });

    it('Seller Gujarat + Order Delhi => IGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Delhi' },
        gujaratSeller,
      );
      expect(tax).toEqual({ igst: 180, cgst: 0, sgst: 0 });
    });

    it('Seller Delhi + Order Delhi => CGST + SGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Delhi' },
        delhiSeller,
      );
      expect(tax).toEqual({ igst: 0, cgst: 90, sgst: 90 });
    });

    it('Seller Delhi + Order Gujarat => IGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Gujarat' },
        delhiSeller,
      );
      expect(tax).toEqual({ igst: 180, cgst: 0, sgst: 0 });
    });

    it('Seller Delhi + Order Maharashtra => IGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Maharashtra' },
        delhiSeller,
      );
      expect(tax).toEqual({ igst: 180, cgst: 0, sgst: 0 });
    });

    it('Seller Maharashtra + Order Maharashtra => CGST + SGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Maharashtra' },
        maharashtraSeller,
      );
      expect(tax).toEqual({ igst: 0, cgst: 90, sgst: 90 });
    });

    it('Seller Maharashtra + Order Gujarat => IGST', () => {
      const tax = splitGstForStateWiseRow(
        { ...baseRow, stateName: 'Gujarat' },
        maharashtraSeller,
      );
      expect(tax).toEqual({ igst: 180, cgst: 0, sgst: 0 });
    });

    it('re-splits file IGST into CGST/SGST for intra-state Delhi seller', () => {
      const tax = splitGstForStateWiseRow(
        {
          ...baseRow,
          stateName: 'NCT of Delhi',
          igstAmount: 360,
          cgstAmount: 0,
          sgstAmount: 0,
        },
        delhiSeller,
      );
      expect(tax).toEqual({ igst: 0, cgst: 180, sgst: 180 });
    });
  });

  describe('aggregateStateWiseRows', () => {
    it('groups by state and rate with correct tax split', () => {
      const rows = aggregateStateWiseRows(
        [
          { ...baseRow, stateName: 'Delhi' },
          { ...baseRow, stateName: 'Gujarat', quantity: 2 },
        ],
        delhiSeller,
      );

      const delhi = rows.find((r) => r.stateName === 'Delhi');
      const gujarat = rows.find((r) => r.stateName === 'Gujarat');

      expect(delhi).toMatchObject({
        igst: 0,
        cgst: 90,
        sgst: 90,
        invoiceAmount: 1180,
      });
      expect(gujarat).toMatchObject({
        igst: 180,
        cgst: 0,
        sgst: 0,
        qty: 2,
        invoiceAmount: 1180,
      });
    });

    it('keeps invoice amount unchanged while redistributing tax', () => {
      const rows = aggregateStateWiseRows(
        [{ ...baseRow, stateName: 'Delhi' }],
        delhiSeller,
      );
      expect(rows[0].invoiceAmount).toBe(1180);
      expect(rows[0].igst + rows[0].cgst + rows[0].sgst).toBe(180);
    });
  });
});

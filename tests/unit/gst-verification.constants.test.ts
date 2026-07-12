import { parsePerioneRegistrationDate } from '../../src/gsts/gst-verification.constants';

describe('gst-verification.constants', () => {
  it('parsePerioneRegistrationDate parses DD/MM/YYYY from Perione', () => {
    const date = parsePerioneRegistrationDate('20/05/2022');
    expect(date).toBeInstanceOf(Date);
    expect(date?.getFullYear()).toBe(2022);
    expect(date?.getMonth()).toBe(4);
    expect(date?.getDate()).toBe(20);
  });

  it('parsePerioneRegistrationDate returns undefined for invalid values', () => {
    expect(parsePerioneRegistrationDate('')).toBeUndefined();
    expect(parsePerioneRegistrationDate('not-a-date')).toBeUndefined();
    expect(parsePerioneRegistrationDate('32/13/2022')).toBeUndefined();
  });
});

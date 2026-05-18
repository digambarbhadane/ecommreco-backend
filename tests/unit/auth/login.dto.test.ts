import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from '../../../src/auth/dto/login.dto';

describe('LoginDto validation', () => {
  it('accepts valid credentials', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@example.com',
      password: 'secret12',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe('user@example.com');
  });

  it('rejects missing email', async () => {
    const dto = plainToInstance(LoginDto, { password: 'secret12' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects password shorter than 6 characters', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@example.com',
      password: '12345',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('normalizes email to lowercase', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'User@Example.COM',
      password: 'secret12',
    });
    await validate(dto);
    expect(dto.email).toBe('user@example.com');
  });
});

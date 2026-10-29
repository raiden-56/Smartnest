import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, signStreamToken, verifyPassword, verifyStreamToken } from './crypto.js';

describe('credential encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const secret = 'eyJhbGciOiJIUzI1NiJ9.super-secret-token';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain('super-secret');
    expect(decryptSecret(enc)).toBe(secret);
    expect(encryptSecret(secret)).not.toBe(enc); // random IV
  });

  it('detects tampering', () => {
    const enc = Buffer.from(encryptSecret('abc'), 'base64');
    enc[enc.length - 1]! ^= 1;
    expect(() => decryptSecret(enc.toString('base64'))).toThrow();
  });
});

describe('passwords', () => {
  it('verifies only the correct password', async () => {
    const h = await hashPassword('correct-horse-42');
    expect(await verifyPassword('correct-horse-42', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('stream tokens', () => {
  it('rejects tampered and expired tokens', () => {
    const t = signStreamToken({ userId: 'u', deviceId: 'd', homeId: 'h' }, 60);
    expect(verifyStreamToken(t)).toEqual({ userId: 'u', deviceId: 'd', homeId: 'h' });
    expect(verifyStreamToken(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
    expect(verifyStreamToken(signStreamToken({ userId: 'u', deviceId: 'd', homeId: 'h' }, -1))).toBeNull();
  });
});

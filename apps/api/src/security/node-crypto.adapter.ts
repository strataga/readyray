import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PasswordHashCapacityError } from '../modules/identity/application/security.port.js';
import type { PasswordHasher, SessionTokens } from '../modules/identity/application/security.port.js';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const MAX_CONCURRENT_SCRYPTS = 2;
const MAX_QUEUED_SCRYPTS = 16;
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'00'.repeat(16)}$${'00'.repeat(KEY_LENGTH)}`;

let activeScrypts = 0;
const scryptWaiters: Array<() => void> = [];

async function acquireScryptSlot(): Promise<() => void> {
  if (activeScrypts < MAX_CONCURRENT_SCRYPTS) {
    activeScrypts += 1;
  } else {
    if (scryptWaiters.length >= MAX_QUEUED_SCRYPTS) {
      throw new PasswordHashCapacityError();
    }
    await new Promise<void>((resolve) => scryptWaiters.push(resolve));
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = scryptWaiters.shift();
    if (next) {
      next();
    } else {
      activeScrypts -= 1;
    }
  };
}

function deriveKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return acquireScryptSlot().then((release) => new Promise<Buffer>((resolve, reject) => {
    try {
      scryptCallback(password, salt, keyLength, SCRYPT_OPTIONS, (error, derivedKey) => {
        release();
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      });
    } catch (error) {
      release();
      reject(error);
    }
  }));
}

@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt, KEY_LENGTH);
    return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [scheme, n, r, p, saltHex, keyHex, extra] =
      typeof encodedHash === 'string' ? encodedHash.split('$') : [];
    if (scheme !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' || extra !== undefined ||
        !saltHex || !keyHex || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) {
      await deriveKey(password, Buffer.alloc(16), KEY_LENGTH);
      return false;
    }
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(actual, expected);
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(password, DUMMY_PASSWORD_HASH);
  }
}

@Injectable()
export class NodeSessionTokens implements SessionTokens {
  issue(): { readonly token: string; readonly digest: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, digest: this.digest(token) };
  }

  digest(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

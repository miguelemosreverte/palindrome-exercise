import { execSync } from 'child_process';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import initSqlJs from 'sql.js';

/**
 * Extract cookies from Chrome on macOS.
 * Chrome v10+ uses AES-128-CBC with Keychain-stored key.
 * Chrome v20+ uses AES-256-GCM with Keychain-stored key.
 */
export async function getChromeCookes(domain = '.linkedin.com') {
  const cookieDbPath = join(process.env.HOME, 'Library/Application Support/Google/Chrome/Default/Cookies');
  const tmpDb = '/tmp/chrome-cookies-copy.sqlite';

  if (!existsSync(cookieDbPath)) throw new Error('Chrome Cookies DB not found');
  copyFileSync(cookieDbPath, tmpDb);

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(tmpDb));

  const results = db.exec(
    `SELECT name, encrypted_value, host_key, path, is_secure, is_httponly, expires_utc, samesite
     FROM cookies WHERE host_key LIKE '%${domain}%'`
  );
  db.close();

  if (!results.length) return [];

  // Get Chrome Safe Storage key from Keychain
  let key;
  try {
    key = execSync('security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"', { encoding: 'utf8' }).trim();
  } catch {
    console.log('[cookies] Cannot access Chrome Safe Storage key');
    return [];
  }

  const crypto = await import('crypto');

  // v10 key: PBKDF2(password, 'saltysalt', 1003, 16, sha1)
  const v10Key = crypto.pbkdf2Sync(key, 'saltysalt', 1003, 16, 'sha1');
  // v20 key: PBKDF2(password, 'saltysalt', 1003, 32, sha1)
  const v20Key = crypto.pbkdf2Sync(key, 'saltysalt', 1003, 32, 'sha1');

  const cookies = [];
  for (const row of results[0].values) {
    const [name, encryptedValue, hostKey, path, isSecure, isHttpOnly, expiresUtc, sameSite] = row;

    const buf = Buffer.from(encryptedValue);
    if (buf.length < 4) continue;

    const version = buf.slice(0, 3).toString();
    let value = '';

    try {
      if (version === 'v10' || version === 'v20') {
        const payload = buf.slice(3);
        const iv = Buffer.alloc(16, ' ');
        const decipher = crypto.createDecipheriv('aes-128-cbc', v10Key, iv);
        const dec = Buffer.concat([decipher.update(payload), decipher.final()]);
        // Chrome AES-CBC decryption produces the value with possible binary prefix.
        // Find the start of printable ASCII content.
        const bytes = new Uint8Array(dec);
        let start = 0;
        for (let i = bytes.length - 1; i >= 0; i--) {
          if (bytes[i] < 0x20 || bytes[i] > 0x7e) { start = i + 1; break; }
        }
        value = dec.slice(start).toString('utf8');
      } else {
        continue;
      }
    } catch {
      continue;
    }

    if (!value || /[\x00-\x08\x0e-\x1f]/.test(value)) continue;

    const chromeEpochOffset = 11644473600n;
    const expiry = expiresUtc ? Number((BigInt(expiresUtc) / 1000000n) - chromeEpochOffset) : -1;
    const sameSiteMap = { 0: 'None', 1: 'Lax', 2: 'Strict' };

    cookies.push({
      name,
      value,
      domain: hostKey,
      path: path || '/',
      secure: !!isSecure,
      httpOnly: !!isHttpOnly,
      expires: expiry > 0 ? expiry : undefined,
      sameSite: sameSiteMap[sameSite] || 'Lax',
    });
  }

  console.log(`[cookies] Extracted ${cookies.length} decrypted cookies for ${domain}`);
  return cookies;
}

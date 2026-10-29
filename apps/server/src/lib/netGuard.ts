import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { badRequest } from './errors.js';

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isAlwaysBlocked(ip: string): boolean {
  if (ip.includes(':')) return ip === '::' ;
  const [a, b] = ip.split('.').map(Number) as [number, number];
  // 0.0.0.0/8, link-local incl. cloud metadata 169.254.169.254, multicast/reserved
  return a === 0 || (a === 169 && b === 254) || a >= 224;
}

/**
 * Validate a user-supplied integration URL before the server connects to it.
 * Prevents the integration form being used to reach cloud metadata endpoints
 * or (when disabled) internal network ranges.
 */
export async function assertSafeIntegrationUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Enter a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Only http:// and https:// URLs are allowed.');
  if (url.username || url.password) throw badRequest('Do not put credentials in the URL; use the access token field.');
  if (config.isProd && url.protocol === 'http:' && !config.allowPrivateIntegrationHosts) throw badRequest('Use https:// for remote integrations.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw badRequest(`Could not resolve "${host}". Check the address and that the SmartNest server can reach it.`);
    }
  }
  for (const ip of addresses) {
    if (isAlwaysBlocked(ip)) throw badRequest('That address is not allowed.');
    if (!config.allowPrivateIntegrationHosts && isPrivate(ip)) throw badRequest('Private network addresses are disabled on this server.');
  }
  return url;
}

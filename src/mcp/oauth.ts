// OAuth 2.1 for a remote MCP server: protected-resource and authorization-server discovery, dynamic client registration,
// authorization code with PKCE through a localhost callback, token storage under ~/.pjman/auth, refresh.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { userDir } from '../config.js';

export interface StoredAuth {
  issuer: string;
  resource: string;
  client_id: string;
  client_secret?: string;
  token_endpoint: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scope?: string;
}

export function authPath(name: string): string {
  return path.join(userDir(), 'auth', `${name}.json`);
}

export function readAuth(name: string): StoredAuth | null {
  try {
    return JSON.parse(fs.readFileSync(authPath(name), 'utf8')) as StoredAuth;
  } catch {
    return null;
  }
}

export function writeAuth(name: string, auth: StoredAuth): void {
  const file = authPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 });
}

export function clearAuth(name: string): boolean {
  const file = authPath(name);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

interface AsMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** The authorization server for an MCP resource: its protected-resource metadata first, then the well-known location on its origin. */
export async function discover(resourceUrl: string, fetchImpl: typeof fetch = fetch): Promise<AsMetadata> {
  const u = new URL(resourceUrl);
  const origin = `${u.protocol}//${u.host}`;
  const prm = (await getJson(`${origin}/.well-known/oauth-protected-resource${u.pathname === '/' ? '' : u.pathname}`, fetchImpl)
    ?? await getJson(`${origin}/.well-known/oauth-protected-resource`, fetchImpl)) as { authorization_servers?: string[] } | null;
  const issuers = prm?.authorization_servers?.length ? prm.authorization_servers : [origin];
  for (const issuer of issuers) {
    const iu = new URL(issuer);
    const base = `${iu.protocol}//${iu.host}`;
    const suffix = iu.pathname === '/' ? '' : iu.pathname;
    const md = (await getJson(`${base}/.well-known/oauth-authorization-server${suffix}`, fetchImpl)
      ?? await getJson(`${base}/.well-known/openid-configuration${suffix}`, fetchImpl)) as AsMetadata | null;
    if (md?.authorization_endpoint && md.token_endpoint) return { ...md, issuer: md.issuer ?? issuer };
  }
  throw new Error(`no OAuth authorization server found for ${resourceUrl}`);
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // the URL is printed either way
  }
}

export interface LoginOpts {
  name: string;
  resourceUrl: string;
  scope?: string;
  clientName?: string;
  fetchImpl?: typeof fetch;
  /** Called with the URL to open; default opens the browser and prints it. */
  onAuthorize?: (url: string) => void;
  timeoutMs?: number;
}

/** The full flow: discover, register, authorize in the browser, exchange, store. Resolves with the stored auth. */
export async function login(opts: LoginOpts): Promise<StoredAuth> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const md = await discover(opts.resourceUrl, fetchImpl);
  const callback = await new Promise<{ server: http.Server; port: number; code: Promise<{ code: string; state: string }> }>((resolve, reject) => {
    let settle: (v: { code: string; state: string }) => void = () => {};
    let fail: (e: Error) => void = () => {};
    const code = new Promise<{ code: string; state: string }>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>pjman</title><body style="font-family:system-ui;padding:40px"><h2>${err ? 'Sign-in failed' : 'Signed in'}</h2><p>${err ? `${err}: ${u.searchParams.get('error_description') ?? ''}` : 'You can close this tab and return to the terminal.'}</p>`);
      if (err) fail(new Error(`${err}: ${u.searchParams.get('error_description') ?? ''}`));
      else settle({ code: u.searchParams.get('code') ?? '', state: u.searchParams.get('state') ?? '' });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({ server, port: typeof a === 'object' && a ? a.port : 0, code });
    });
  });
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`;
  try {
    // dynamic client registration, when the server offers it
    let clientId = '';
    let clientSecret: string | undefined;
    if (md.registration_endpoint) {
      const reg = await fetchImpl(md.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_name: opts.clientName ?? 'pjman',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: opts.scope,
        }),
      });
      if (!reg.ok) throw new Error(`client registration failed: ${reg.status} ${(await reg.text()).slice(0, 300)}`);
      const r = (await reg.json()) as { client_id: string; client_secret?: string };
      clientId = r.client_id;
      clientSecret = r.client_secret;
    } else {
      throw new Error(`${md.issuer} does not support dynamic client registration; pass a token instead`);
    }
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));
    const auth = new URL(md.authorization_endpoint);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('code_challenge', challenge);
    auth.searchParams.set('code_challenge_method', 'S256');
    auth.searchParams.set('state', state);
    auth.searchParams.set('resource', opts.resourceUrl);
    if (opts.scope) auth.searchParams.set('scope', opts.scope);
    if (opts.onAuthorize) opts.onAuthorize(auth.toString());
    else {
      process.stderr.write(`Opening the browser to sign in. If it does not open, visit:\n${auth}\n`);
      openBrowser(auth.toString());
    }
    const got = await Promise.race([
      callback.code,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out waiting for the browser sign-in')), opts.timeoutMs ?? 5 * 60 * 1000)),
    ]);
    if (got.state !== state) throw new Error('the callback state did not match; refusing the code');
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: got.code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: opts.resourceUrl });
    if (clientSecret) form.set('client_secret', clientSecret);
    const tok = await fetchImpl(md.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form });
    if (!tok.ok) throw new Error(`token exchange failed: ${tok.status} ${(await tok.text()).slice(0, 300)}`);
    const t = (await tok.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    const stored: StoredAuth = {
      issuer: md.issuer, resource: opts.resourceUrl, client_id: clientId, client_secret: clientSecret, token_endpoint: md.token_endpoint,
      access_token: t.access_token, refresh_token: t.refresh_token, scope: t.scope,
      expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined,
    };
    writeAuth(opts.name, stored);
    return stored;
  } finally {
    callback.server.close();
  }
}

/** A fresh access token through the refresh token, stored; null when there is nothing to refresh with. */
export async function refresh(name: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const a = readAuth(name);
  if (!a?.refresh_token) return null;
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: a.client_id, resource: a.resource });
  if (a.client_secret) form.set('client_secret', a.client_secret);
  const res = await fetchImpl(a.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form });
  if (!res.ok) return null;
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const next: StoredAuth = { ...a, access_token: t.access_token, refresh_token: t.refresh_token ?? a.refresh_token, expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined };
  writeAuth(name, next);
  return next.access_token;
}

/** The token to use now: a refresh first when the stored one has expired. */
export async function currentToken(name: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const a = readAuth(name);
  if (!a) return null;
  if (a.expires_at && Date.parse(a.expires_at) < Date.now() + 30_000) return (await refresh(name, fetchImpl)) ?? a.access_token;
  return a.access_token;
}

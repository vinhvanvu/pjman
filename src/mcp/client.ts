// A minimal MCP client over Streamable HTTP: JSON-RPC 2.0 by POST, responses as JSON or as a server-sent event stream.
// Three calls are enough for a sync adapter: initialize, tools/list, tools/call. No dependencies.

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
}

export interface McpContent {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export class McpError extends Error {
  constructor(message: string, public status?: number, public code?: number, public data?: unknown) {
    super(message);
  }
}

export interface McpClientOpts {
  url: string;
  /** Bearer token (OAuth access token or API key). */
  token?: string;
  /** Called on 401 to obtain a fresh token; the request is retried once. */
  refresh?: () => Promise<string | null>;
  clientInfo?: { name: string; version: string };
  fetchImpl?: typeof fetch;
}

const PROTOCOL = '2025-06-18';

/** The JSON-RPC response for `id` from a text/event-stream body. */
function fromEventStream(text: string, id: number): unknown {
  for (const block of text.split(/\n\n+/)) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (!data) continue;
    try {
      const msg = JSON.parse(data) as { id?: unknown };
      if (msg.id === id) return msg;
    } catch {
      // not JSON; skip
    }
  }
  throw new McpError(`no response for request ${id} in the event stream`);
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private token: string | undefined;
  public serverInfo: { name?: string; version?: string } | null = null;
  public tools: McpTool[] = [];
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: McpClientOpts) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post(body: unknown, retry = true): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await this.fetchImpl(this.opts.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (res.status === 401 && retry && this.opts.refresh) {
      const fresh = await this.opts.refresh();
      if (fresh) {
        this.token = fresh;
        return this.post(body, false);
      }
    }
    const text = await res.text();
    if (res.status === 202 || !text) return { status: res.status, json: null };
    const type = res.headers.get('content-type') ?? '';
    const id = (body as { id?: number }).id;
    if (type.includes('text/event-stream')) return { status: res.status, json: id !== undefined ? fromEventStream(text, id) : null };
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      throw new McpError(`${this.opts.url} answered ${res.status} with a body that is not JSON: ${text.slice(0, 200)}`, res.status);
    }
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const { status, json } = await this.post({ jsonrpc: '2.0', id, method, params });
    if (status === 401) throw new McpError(`${this.opts.url}: not authorised (401); run pjman auth or pass a token`, 401);
    if (status >= 400) throw new McpError(`${this.opts.url}: ${method} answered ${status}${json ? ` ${JSON.stringify(json).slice(0, 300)}` : ''}`, status);
    const msg = json as { result?: T; error?: { code: number; message: string; data?: unknown } } | null;
    if (!msg) throw new McpError(`${method}: empty response`);
    if (msg.error) throw new McpError(`${method}: ${msg.error.message}`, status, msg.error.code, msg.error.data);
    return msg.result as T;
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  /** initialize + initialized, then the tool list. */
  async connect(): Promise<this> {
    const init = await this.request<{ serverInfo?: { name?: string; version?: string }; protocolVersion?: string }>('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: this.opts.clientInfo ?? { name: 'pjman', version: '0.1.0' },
    });
    this.serverInfo = init.serverInfo ?? null;
    await this.notify('notifications/initialized');
    this.tools = await this.listTools();
    return this;
  }

  async listTools(): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<{ tools: McpTool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {});
      out.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  tool(name: string): McpTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const r = await this.request<McpToolResult>('tools/call', { name, arguments: args });
    if (r.isError) throw new McpError(`${name}: ${r.content?.map((c) => c.text ?? '').join('\n').slice(0, 500) || 'the tool reported an error'}`);
    return r;
  }

  /** The tool's result as data: structuredContent when given, else the first text content parsed as JSON, else the text. */
  async callJson(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const r = await this.call(name, args);
    if (r.structuredContent !== undefined) return r.structuredContent;
    const text = r.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Keep only the arguments the tool declares, so a schema the docs do not publish still gets what it accepts. */
  argsFor(name: string, candidates: Record<string, unknown>): Record<string, unknown> {
    const props = this.tool(name)?.inputSchema?.properties;
    if (!props) return candidates;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(candidates)) if (k in props && v !== undefined) out[k] = v;
    return out;
  }
}

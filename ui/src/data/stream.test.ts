import { describe, expect, test } from 'vitest';
import { createHub, type Frame, type Port, type Request } from './stream';

function page() {
  const got: Frame[] = [];
  let listener: ((ev: MessageEvent<Request>) => void) | undefined;
  const port: Port = {
    postMessage: (f) => got.push(f),
    addEventListener: (_type, l) => {
      listener = l;
    },
  };
  const send = (r: Request) => listener?.({ data: r } as MessageEvent<Request>);
  return { port, got, send };
}

function streams() {
  const opened: { url: string; emit: (f: Frame) => void; closed: boolean }[] = [];
  const open = (url: string, emit: (f: Frame) => void) => {
    const s = { url, emit, closed: false };
    opened.push(s);
    return () => {
      s.closed = true;
    };
  };
  return { opened, open };
}

describe('one stream per browser', () => {
  test('any number of pages share one stream', () => {
    const { opened, open } = streams();
    const hub = createHub(open);
    const pages = Array.from({ length: 8 }, page);
    for (const p of pages) {
      hub.attach(p.port);
      p.send({ kind: 'start', url: 'http://127.0.0.1:7331/api/v1/events' });
    }
    expect(opened).toHaveLength(1);
    expect(hub.size).toBe(8);
    opened[0]!.emit({ kind: 'event', data: '{"seq":1}' });
    for (const p of pages) expect(p.got).toEqual([{ kind: 'event', data: '{"seq":1}' }]);
  });

  test('a page arriving on an open stream is told it is open', () => {
    const { opened, open } = streams();
    const hub = createHub(open);
    const a = page();
    hub.attach(a.port);
    a.send({ kind: 'start', url: '/events' });
    opened[0]!.emit({ kind: 'open' });
    const b = page();
    hub.attach(b.port);
    b.send({ kind: 'start', url: '/events' });
    expect(b.got).toEqual([{ kind: 'open' }]);
  });

  test("a page arriving on an open stream is given each session's standing action, not a cleared one", () => {
    const { opened, open } = streams();
    const hub = createHub(open);
    const a = page();
    hub.attach(a.port);
    a.send({ kind: 'start', url: '/events' });
    const now = (key: string, text?: string) => ({ kind: 'now' as const, data: JSON.stringify({ key, text }) });
    opened[0]!.emit({ kind: 'open' });
    opened[0]!.emit(now('session:a', 'Reading a.ts'));
    opened[0]!.emit(now('session:a', 'Editing a.ts'));
    opened[0]!.emit(now('session:b', 'Running the tests'));
    opened[0]!.emit(now('session:b'));
    const b = page();
    hub.attach(b.port);
    b.send({ kind: 'start', url: '/events' });
    expect(b.got).toEqual([{ kind: 'open' }, now('session:a', 'Editing a.ts')]);
  });

  test('the stream closes with the last page and opens again with the next', () => {
    const { opened, open } = streams();
    const hub = createHub(open);
    const a = page();
    const b = page();
    for (const p of [a, b]) {
      hub.attach(p.port);
      p.send({ kind: 'start', url: '/events' });
    }
    a.send({ kind: 'leave' });
    expect(opened[0]!.closed).toBe(false);
    b.send({ kind: 'leave' });
    b.send({ kind: 'leave' });
    expect(opened[0]!.closed).toBe(true);
    const c = page();
    hub.attach(c.port);
    c.send({ kind: 'start', url: '/events' });
    expect(opened).toHaveLength(2);
    expect(c.got).toEqual([]);
  });

  test('a page that left hears nothing more', () => {
    const { opened, open } = streams();
    const hub = createHub(open);
    const a = page();
    const b = page();
    for (const p of [a, b]) {
      hub.attach(p.port);
      p.send({ kind: 'start', url: '/events' });
    }
    a.send({ kind: 'leave' });
    opened[0]!.emit({ kind: 'error' });
    expect(a.got).toEqual([]);
    expect(b.got).toEqual([{ kind: 'error' }]);
  });
});

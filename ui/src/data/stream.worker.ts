// The SharedWorker every pjman page of a browser shares: it holds the one event stream (data/stream).
/// <reference lib="webworker" />
import { createHub, openStream } from './stream';

declare const self: SharedWorkerGlobalScope;

const hub = createHub(openStream);
self.addEventListener('connect', (ev) => {
  const port = ev.ports[0];
  if (port) hub.attach(port);
});

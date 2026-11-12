// node:sqlite emits an ExperimentalWarning when it loads. Node prints warnings from its default 'warning'
// listener; this module, loaded first, replaces that listener with one that drops that single warning.
process.removeAllListeners('warning');
process.on('warning', (w: Error & { code?: string }) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  process.stderr.write(`(node:${process.pid}) ${w.code ? `[${w.code}] ` : ''}${w.name}: ${w.message}\n`);
});
export {};

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChangeRow, ScopeNode } from '../api';
import { Key, short, Status, useHref } from './Keys';
import { HealthStrip } from './Strips';

/** The change row: one component for every lens and view. */
export function ChangeRowView({ r, multi, selected }: { r: ChangeRow; multi: boolean; selected?: boolean }) {
  const href = useHref();
  return (
    <div className={`crow${selected ? ' selected' : ''}`}>
      <div className="crow-main">
        {r.live && <span className="live" title="a session is on it">●</span>}
        <Link to={href(r.key)} className="title">{r.title ?? r.key}</Link>
        <Status s={r.status} />
        {r.ticket &&
          (r.ticket.url ? (
            <a className="ticket" href={r.ticket.url} target="_blank" rel="noreferrer" title={r.ticket.key}>{r.ticket.label}</a>
          ) : (
            <span className="ticket" title={r.ticket.key}>{r.ticket.label}</span>
          ))}
        {r.progress && (
          <span className="progress" title={`${r.progress.done} of ${r.progress.total} children done`}>
            {r.progress.done}/{r.progress.total}
          </span>
        )}
        {r.waiting > 0 && (
          <span className="needs-me" title={`${r.waiting} decision${r.waiting === 1 ? '' : 's'} waiting on you`}>
            ○ {r.waiting}
          </span>
        )}
        {multi && r.project && <span className="repo" title={r.project}>{short(r.project)}</span>}
      </div>
      {(r.next || r.features.length > 0) && (
        <div className="crow-sub">
          {r.next && <span className="next-line" title={r.next}>{r.next}</span>}
          {r.features.length > 0 && (
            <span className="chips">
              {r.features.map((f) => (
                <Key key={f.key} k={f.key} className={`chip effect-${f.effect}`}>
                  {f.effect !== 'changes' && <i>{f.effect} </i>}
                  {short(f.key)}
                </Key>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A structure row: a product, a feature at its level, a project, or the closing row for what the lens did not place. */
function NodeRow({ n, multi, selected, open, toggle }: { n: ScopeNode; multi: boolean; selected?: boolean; open: boolean; toggle: () => void }) {
  const href = useHref();
  const state = n.type === 'feature' ? n.derived ?? n.status : undefined;
  const kids = n.childCount ? `${n.childCount} ${n.type === 'project' ? (n.childCount === 1 ? 'project' : 'projects') : n.childCount === 1 ? 'feature' : 'features'}` : '';
  return (
    <div className={`nrow nrow-${n.type}${selected ? ' selected' : ''}`}>
      <div className="nrow-main">
        <button type="button" className="disclose" onClick={toggle} aria-label={open ? 'collapse' : 'expand'} disabled={!n.children.length}>
          {n.children.length ? (open ? '▾' : '▸') : '·'}
        </button>
        {n.type === 'unassigned' ? <span className="title muted">{n.title}</span> : <Link to={href(n.key)} className="title">{n.title ?? n.key}</Link>}
        {n.level && n.type !== 'product' && n.type !== 'unassigned' && <span className="level">{n.level}</span>}
        {state && <span className={`state state-${state}`}>{state}</span>}
        {n.status && n.derived && n.status !== n.derived && <span className="muted authored" title="the authored status differs from what the changes say">authored {n.status}</span>}
        {n.progress && (
          <span className="progress" title={`${n.progress.done} of ${n.progress.total} changes done`}>
            {n.progress.done}/{n.progress.total}
          </span>
        )}
      </div>
      <div className="nrow-sub">
        <span className="counts">
          {n.open} open{n.inFlight ? `, ${n.inFlight} in flight` : ''}
          {kids ? ` · ${kids}` : ''}
        </span>
        {multi && n.projects.map((p) => <span key={p} className="repo" title={p}>{short(p)}</span>)}
        {n.owners.length > 0 && (
          <span className="owners" title={n.ownersFrom && n.ownersFrom !== n.key ? `owners from ${n.ownersFrom}` : 'owners'}>
            {n.owners.map(short).join(', ')}
            {n.ownersFrom && n.ownersFrom !== n.key ? ' ↑' : ''}
          </span>
        )}
        {n.health && <HealthStrip h={n.health} compact />}
      </div>
    </div>
  );
}

function TreeItem({ n, multi, selected, depth }: { n: ScopeNode; multi: boolean; selected?: string; depth: number }) {
  const [open, setOpen] = useState(true);
  if (n.type === 'change' && n.row) {
    return (
      <li className="titem titem-change">
        <ChangeRowView r={n.row} multi={multi} selected={n.key === selected} />
        {n.children.length > 0 && <Tree nodes={n.children} multi={multi} selected={selected} depth={depth + 1} />}
      </li>
    );
  }
  return (
    <li className={`titem titem-${n.type}`}>
      <NodeRow n={n} multi={multi} selected={n.key === selected} open={open} toggle={() => setOpen((o) => !o)} />
      {open && n.children.length > 0 && <Tree nodes={n.children} multi={multi} selected={selected} depth={depth + 1} />}
    </li>
  );
}

/** The tree view: structure rows with change rows beneath, nested as the lens decided. */
export function Tree({ nodes, multi, selected, depth = 0 }: { nodes: ScopeNode[]; multi: boolean; selected?: string; depth?: number }) {
  if (!nodes.length && depth === 0) return <p className="muted empty-tree">nothing open here</p>;
  return (
    <ul className={`tree depth-${depth}`}>
      {nodes.map((n) => (
        <TreeItem key={n.key} n={n} multi={multi} selected={selected} depth={depth} />
      ))}
    </ul>
  );
}

const LANES = ['active', 'blocked', 'review', 'planning', 'open', 'done'];

/** The lanes view: the same changes by status, nested by parent inside a lane. */
export function Lanes({ rows, multi, selected }: { rows: ChangeRow[]; multi: boolean; selected?: string }) {
  const keys = new Set(rows.map((r) => r.key));
  const top = rows.filter((r) => !(r.parent && keys.has(r.parent)));
  const statuses = [...LANES.filter((s) => top.some((r) => r.status === s)), ...new Set(top.map((r) => r.status ?? '?').filter((s) => !LANES.includes(s)))];
  const kidsOf = (k: string) => rows.filter((r) => r.parent === k);
  const item = (r: ChangeRow) => (
    <li key={r.key} className="titem titem-change">
      <ChangeRowView r={r} multi={multi} selected={r.key === selected} />
      {kidsOf(r.key).length > 0 && <ul className="tree depth-1">{kidsOf(r.key).map(item)}</ul>}
    </li>
  );
  if (!rows.length) return <p className="muted empty-tree">nothing open here</p>;
  return (
    <div className="lanes">
      {statuses.map((s) => {
        const mine = top.filter((r) => (r.status ?? '?') === s);
        return (
          <section key={s} className={`lane lane-${s}`}>
            <h3>
              {s} <span className="count">{mine.length}</span>
            </h3>
            <ul className="tree depth-0">{mine.map(item)}</ul>
          </section>
        );
      })}
    </div>
  );
}

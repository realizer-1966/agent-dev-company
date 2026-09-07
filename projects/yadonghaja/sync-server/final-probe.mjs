import * as core from '@syncular/core';
const body = core.encodeMessage({wireVersion: 2, msgKind: 'request', frames: [
  {type: 'REQ_HEADER', clientId: 'final-check', schemaVersion: 1},
  {type: 'PULL_HEADER', limitCommits: 10, limitSnapshotRows: 100, maxSnapshotPages: 2, accept: 3},
]});
const resp = await fetch('https://yadonghaja-sync-v2.dydtnsp.workers.dev/sync', {
  method: 'POST',
  headers: {'Content-Type': 'application/vnd.syncular.sync.v2', 'x-user': 'final-check'},
  body,
});
console.log('HTTP:', resp.status);
const msg = core.decodeMessage(new Uint8Array(await resp.arrayBuffer()));
console.log('프레임:', msg.frames.map(f=>f.type).join(','));

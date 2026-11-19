import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
async function load(path) {
  const r = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const shared = await load('src/shared.ts');
const { renderSnapshot, safeMarkdown } = await load('src/render.ts');
const { Transport } = await load('src/transport.ts');
const { Service } = await load('src/service.ts');
const { saveSnapshot, digest } = await load('src/sync.ts');
const id = '20260101010101-abcdefg';
const article = 'aabbccddeeff';
const options = { notes: true, highlights: true, bilingual: true };

test('URL and attachment validation rejects traversal, credentials and unsafe schemes', () => {
  assert.equal(shared.baseURL('https://host/prefix/api/v1/'), 'https://host/prefix');
  for (const value of ['file:///tmp', 'https://user:pass@host', 'http://host?token=x']) assert.throws(() => shared.baseURL(value));
  assert.equal(shared.assetPath('/assets/a%20b.PDF#page=2', true), 'assets/a b.PDF');
  for (const value of ['file:///a.pdf', '/data/a.pdf', 'assets/../conf/a.pdf', 'assets/%2e%2e/a.pdf', 'assets/%252e%252e/a.pdf', 'assets/a\\b.pdf', 'https://host/a.pdf']) assert.throws(() => shared.assetPath(value, true));
  assert.throws(() => shared.syncOptions({ notes: false, highlights: false, bilingual: false }));
});

test('render selections retain notes, quote, color, effective bilingual structures and safe source links', () => {
  const data = { document: { title_en: 'Title' }, notes: { paper_note: { body: 'whole-note' }, items: [{ id: 'n', anchor: 'p 1', body: 'paragraph-note', quote: 'quote', kind: 'question' }] },
    highlights: { items: [{ id: 'h', anchor: 'p1', color: 'yellow', quote: 'excerpt' }] },
    content: { items: [{ id: 'p1', type: 'para', en: 'original', zh: '译文' }, { id: 'l1', type: 'list', items: [{ en: 'one', zh: '一' }] }, { id: 'm1', type: 'math', tex: 'x^2' }, { id: 't1', type: 'table', head: [['A','B']], rows: [['a','b']] }] } };
  const markdown = renderSnapshot(data, options, 'http://host/prefix', article);
  for (const text of ['whole-note', 'paragraph-note', 'excerpt', 'yellow', 'original', '译文', 'x^2', '| A | B |', '#p%201']) assert.ok(markdown.includes(text), text);
  assert.ok(!renderSnapshot(data, { notes: true, highlights: false, bilingual: false }, 'http://host', article).includes('excerpt'));
  assert.throws(() => renderSnapshot({ document: {}, content: { items: [] } }, options, 'http://host', article), /结构化正文/);
  assert.ok(safeMarkdown('<script>x</script>\n{{query}}\n{: id="x"}\n;;;widget\n[x](javascript:alert)').includes('&lt;script'));
  assert.ok(!safeMarkdown('[x](javascript:bad)').includes('javascript:'));
});

test('kernel proxy emits exact binary/JSON bytes, no redirects, and never reflects upstream secrets', async () => {
  const requests = [];
  const host = { client: { fetch: async (path, init) => {
    requests.push([path, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{"ok":true}' } }) };
  } } };
  const t = new Transport(host, { baseUrl: 'http://host/proxy', accessCode: 'private-code' });
  await t.remote('/imports/html', { html: '中文' });
  assert.equal(requests[0][0], '/api/network/forwardProxy');
  const body = requests[0][1];
  assert.equal(body.redirect, false);
  assert.equal(body.payloadEncoding, 'base64');
  assert.deepEqual(JSON.parse(Buffer.from(body.payload, 'base64').toString()), { html: '中文' });
  assert.equal(body.url, 'http://host/proxy/api/v1/imports/html');
  const pdf = Uint8Array.from([37,80,68,70,0,255]);
  await t.remote('/imports/file', undefined, pdf.buffer);
  assert.deepEqual(Buffer.from(requests[1][1].payload, 'base64'), Buffer.from(pdf));
  host.client.fetch = async () => { throw new Error('Authorization: Bearer private-code'); };
  await assert.rejects(t.remote('/info'), e => !e.message.includes('private-code'));
});

test('pagination reads all pages and rejects version drift, duplicates and stalled cursors', async () => {
  const t = new Transport({}, { baseUrl: 'http://host', accessCode: '' });
  let n = 0;
  t.remote = async () => (++n === 1 ? { items: [{ id: 'one' }], total: 2, next_offset: 1, version: 'v1' } : { items: [{ id: 'two' }], total: 2, next_offset: null, version: 'v1' });
  assert.equal((await t.all('/notes')).items.length, 2);
  n = 0;
  t.remote = async () => (++n === 1 ? { items: [{ id: 'one' }], total: 2, next_offset: 1, version: 'v1' } : { items: [{ id: 'two' }], total: 2, next_offset: null, version: 'v2' });
  await assert.rejects(t.all('/notes'), /变化/);
  t.remote = async () => ({ items: [{ id: 'one' }], total: 2, next_offset: 0 });
  await assert.rejects(t.all('/notes'), /游标/);
  t.remote = async () => ({ items: [{ id: 'one' }, { id: 'one' }], total: 2, next_offset: null });
  await assert.rejects(t.all('/notes'), /重复/);
});

test('settings do not expose or forward old secrets to a new host', async () => {
  const files = new Map();
  const service = new Service({ storage: { list: async () => [...files.keys()].map(name => ({ name })), get: async name => ({ json: async () => files.get(name) }), put: async (name, value) => files.set(name, JSON.parse(value)) } });
  await service.saveSettings({ baseUrl: 'http://host', accessCode: 'secret' });
  assert.deepEqual(await service.getSettings(), { baseUrl: 'http://host', hasCode: true });
  await service.saveSettings({ baseUrl: 'http://new-host' });
  assert.equal((await service.transport()).settings.accessCode, '');
});

test('accepted import preserves task ID if journal persistence fails', async () => {
  const service = new Service({});
  service.resolveDoc = async () => ({});
  service.transport = async () => ({ local: async path => path.includes('export') ? { content: 'note', hPath: '/Note' } : { html: '<p>note</p>' }, remote: async path => path === '/info' ? { capabilities: ['import_html'] } : { task_id: 'c'.repeat(32), state: 'queued' } });
  service.recordTask = async () => { throw new Error('disk full'); };
  const result = await service.importDocument({ docId: id });
  assert.equal(result.task_id, 'c'.repeat(32));
  assert.match(result.warnings[0], /已提交任务/);
});

test('uncertain snapshot keeps recovery journal; abandonment only clears that journal', async () => {
  const binding = { documentId: article, baseUrl: 'http://host', options };
  const data = { document: { title_en: 'Test' }, notes: { items: [] }, highlights: { items: [] }, content: { items: [{ id: 'p', type: 'para', en: 'Original' }] } };
  const markdown = renderSnapshot(data, options, 'http://host', article);
  const t = { settings: { baseUrl: 'http://host' }, remote: async () => data.document, all: async path => path.includes('notes') ? data.notes : path.includes('highlights') ? data.highlights : data.content,
    local: async () => { throw new Error('connection lost'); } };
  const service = new Service({});
  service.transport = async () => t;
  service.resolveDoc = async () => ({ box: id });
  service.binding = async () => binding;
  const writes = [];
  service.setBinding = async (_id, value) => writes.push(JSON.parse(JSON.stringify(value)));
  await assert.rejects(saveSnapshot(service, id, options, await digest(markdown)), /未能确认/);
  assert.ok(binding.pending);
  assert.equal(writes.length, 1);
  await service.abandonPending({ docId: id, pendingId: binding.pending.id });
  assert.equal(binding.pending, undefined);
  assert.equal(writes.length, 2);
});

function taskService(records, responder = async () => { throw new Error('offline'); }) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const files = new Map([['tasks.json', copy(records)], ['settings.json', { baseUrl: 'https://current.test', accessCode: 'private-code' }]]);
  const calls = [];
  const host = {
    storage: { list: async () => [...files.keys()].map(name => ({ name })), get: async name => ({ json: async () => copy(files.get(name)) }), put: async (name, value) => files.set(name, JSON.parse(value)) },
    client: { fetch: async (path, init) => {
      assert.equal(path, '/api/network/forwardProxy', 'task operations must not mutate documents');
      const proxy = JSON.parse(init.body);
      assert.equal(proxy.method, 'GET', 'no remote writes');
      const endpoint = new URL(proxy.url).pathname;
      calls.push(endpoint);
      const reply = await responder(endpoint);
      return { ok: true, json: async () => ({ code: 0, data: { status: reply.status || 200, body: JSON.stringify(reply.data) } }) };
    } },
  };
  return { service: new Service(host), files, calls };
}
const taskId = 'c'.repeat(32);
const record = (extra = {}) => ({ taskId, baseUrl: 'https://current.test', created: '2026-01-01', docId: id, bind: true, state: 'queued', ...extra });

test('remove history offline by server plus task ID; preserve settings, bindings and other records', async () => {
  const records = [record(), record({ baseUrl: 'https://old.test' }), record({ taskId: 'd'.repeat(32), state: 'done' })];
  const { service, files, calls } = taskService(records);
  files.set('settings.json', { baseUrl: '', accessCode: 'preserve-me' });
  assert.deepEqual(await service.removeTask({ taskId, baseUrl: 'https://old.test/' }), { removed: 1 });
  assert.deepEqual(files.get('tasks.json'), [records[0], records[2]]);
  assert.equal(files.get('settings.json').accessCode, 'preserve-me');
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.removeTask({ taskId, baseUrl: 'https://old.test' }), { removed: 0 });
  await assert.rejects(service.removeTask({ taskId: '../bad', baseUrl: 'https://current.test' }));
  assert.equal(files.get('tasks.json').length, 2);
});

test('deleted remote article retains history and skips auto-binding without deleting SiYuan content', async () => {
  const { service, files, calls } = taskService([record()], async path => path.includes('/tasks/')
    ? { data: { state: 'done', document_id: article } }
    : { status: 404, data: { error: { code: 'not_found', message: 'Document not found' } } });
  const result = await service.task(taskId, 'https://current.test');
  assert.equal(result.state, 'done');
  assert.equal(result.document_missing, true);
  assert.equal(files.get('tasks.json')[0].documentId, article);
  assert.equal(files.get('tasks.json').length, 1);
  assert.equal(calls.length, 2);
});

test('missing remote task can be removed without assuming the article was deleted', async () => {
  const { service, files } = taskService([record()], async () => ({ status: 404, data: { error: { code: 'not_found' } } }));
  const result = await service.task(taskId);
  assert.equal(result.state, 'missing');
  assert.equal(result.document_missing, undefined);
  assert.equal(files.get('tasks.json').length, 1);
  await service.removeTask({ taskId, baseUrl: 'https://current.test' });
  assert.deepEqual(files.get('tasks.json'), []);
});

test('API disabled, auth errors and generic 404 are not treated as deleted articles', async () => {
  for (const [status, code] of [[404, 'disabled'], [401, 'unauthorized'], [502, 'not_found'], [404, '']]) {
    const original = record();
    const { service, files } = taskService([original], async path => path.includes('/tasks/')
      ? { data: { state: 'done', document_id: article } }
      : { status, data: { error: { code, message: 'do not reflect private-code' } } });
    await assert.rejects(service.task(taskId), error => error.status === status && error.code === code && !error.message.includes('private-code'));
    assert.deepEqual(files.get('tasks.json'), [original]);
  }
});

test('removal during a slow task request succeeds immediately and late results cannot rebind or resurrect it', async () => {
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const { service, files } = taskService([record()], async path => {
    if (path.includes('/tasks/')) { started(); await pending; return { data: { state: 'done', document_id: article } }; }
    return { data: { id: article } };
  });
  const refreshing = service.task(taskId);
  await requested;
  assert.deepEqual(await service.removeTask({ taskId, baseUrl: 'https://current.test' }), { removed: 1 });
  release();
  assert.equal((await refreshing).removed, true);
  assert.deepEqual(files.get('tasks.json'), []);
});

test('existing remote article still auto-binds; switched settings reject a stale task request', async () => {
  const { service, files, calls } = taskService([record()], async path => ({ data: path.includes('/tasks/') ? { state: 'done', document_id: article } : { id: article } }));
  await assert.rejects(service.task(taskId, 'https://old.test'), /设置已变化/);
  assert.equal(calls.length, 0);
  service.binding = async () => null;
  let binding;
  service.setBinding = async (docId, value) => { assert.equal(docId, id); binding = value; };
  assert.equal((await service.task(taskId)).document_missing, false);
  assert.equal(binding.documentId, article);
  assert.equal(files.get('tasks.json')[0].bind, false);
});

test('missing article and disabled API produce different actionable messages', async () => {
  const { service } = taskService([], async path => ({ status: 404, data: { error: { code: path.endsWith('/info') ? 'disabled' : 'not_found' } } }));
  const transport = await service.transport();
  await assert.rejects(transport.remote('/info'), /开放 API 未启用/);
  await assert.rejects(transport.remote(`/documents/${article}`), /可能已删除/);
  await assert.rejects(transport.remote(`/tasks/${taskId}`), /远端导入任务记录已不存在/);
});

test('frontend contains no HTTP requests; kernel uses only SiYuan client transport', async () => {
  for (const file of ['src/index.ts', 'src/ui.ts']) assert.doesNotMatch(await readFile(file, 'utf8'), /\bfetch\s*\(|XMLHttpRequest|forwardProxy/);
});

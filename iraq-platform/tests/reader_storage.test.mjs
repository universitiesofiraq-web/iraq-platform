import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../site/js/reader-storage.js', import.meta.url), 'utf8');
function open(owner) {
  const context = {document: {documentElement: {dataset: {readerOwner: owner}}}, addEventListener() {}};
  return vm.runInNewContext(source + '\nReaderStorage', context);
}
test('shared-device notes, sync metadata, notebooks, drafts and images follow the session owner', () => {
  const values = new Map();
  const raw = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const owners = ['10', '12', 'guest'];
  for (const key of ['medixa.pdf.annotations.v1:test.pdf', 'medixa.sync.pdf.v1:test', 'medixa.notebooks.v1']) {
    raw.setItem(key, 'legacy');
    for (const owner of owners) {
      const storage = open(owner).scoped(raw);
      assert.equal(storage.getItem(key), null);
      storage.setItem(key, owner);
    }
    for (const owner of owners) assert.equal(open(owner).scoped(raw).getItem(key), owner);
    assert.equal(raw.getItem(key), 'legacy');
    assert.throws(() => open(undefined).scoped(raw).getItem(key));
  }
  for (const db of ['medixa-studio', 'image-assets']) {
    assert.equal(new Set(owners.map(owner => open(owner).name(db))).size, owners.length);
  }
});

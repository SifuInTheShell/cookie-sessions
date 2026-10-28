'use strict';
// Node checks for the Cookie Sessions page and its native cookie wheel.
// Run: node --test tests/wheel.test.cjs
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
// The page script without its module imports; Firebase and the wheel module are injected by the harness.
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from '[^']+';\s*/gm, '')
  .replace(/start\(\);\s*$/, '');
const TAU = Math.PI * 2;
// The wheel names who submitted each queued song, never its title.
const TITLES = ['Alice', 'Bob'];
let wheel; // the real exports of public/cookie-wheel.mjs

before(async () => {
  wheel = await import(pathToFileURL(path.join(root, 'public/cookie-wheel.mjs')).href);
});

// Deterministic stand-in for crypto.getRandomValues: hands out 32-bit words in order.
function fixedRandom(words) {
  let i = 0;
  return { getRandomValues(buffer) { buffer[0] = words[i++ % words.length]; return buffer; } };
}

function harness({ reduceMotion = false, now = 1_700_000_000_000, search = '' } = {}) {
  const elements = new Map(), frames = [], timers = [], transactions = [], deletes = [], sets = [];
  let clock = now, timerSeq = 0, frameCursor = 0;
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    assert.ok(!elements.has(id), `Unique element ID: ${id}`);
    elements.set(id, {
      id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', children: [], listeners: {},
      style: { setProperty() {} },
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); },
        toggle(c, force) { (force ?? !this.set.has(c)) ? this.set.add(c) : this.set.delete(c); } },
      querySelector() { return { textContent: '' }; },
      scrollIntoView() { this.scrolled = true; },
      appendChild(child) { this.children.push(child); }, append() {}, remove() {},
      reset() { this.wasReset = true; }, focus() {}, close() {}, showModal() {}, pause() { this.paused = true; },
      setAttribute() {}, removeAttribute(name) { delete this[name]; },
      addEventListener(type, fn) { this.listeners[type] = fn; }
    });
  }
  class FakeDate extends Date { static now() { return clock; } }
  const context = vm.createContext({
    document: {
      getElementById: id => { assert.ok(elements.has(id), `Existing element: ${id}`); return elements.get(id); },
      createElement: () => ({ className: '', textContent: '', style: { setProperty() {} }, remove() {} }),
      activeElement: null
    },
    crypto: webcrypto, structuredClone, URL, URLSearchParams, console, Date: FakeDate,
    localStorage: { getItem() { return ''; }, setItem() {} },
    setTimeout: (fn, ms = 0) => { const id = ++timerSeq; timers.push({ id, fn, at: clock + ms }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: fn => frames.push({ fn, cancelled: false }),
    cancelAnimationFrame: id => { if (frames[id - 1]) frames[id - 1].cancelled = true; },
    setDoc: async (ref, next) => { context.saved = next; context.savedRef = ref; sets.push({ ref, data: next }); },
    deleteDoc: async ref => { deletes.push(ref.path); },
    writeBatch: () => {
      const ops = [];
      return {
        set(ref, data) { ops.push(() => { context.saved = data; context.savedRef = ref; sets.push({ ref, data }); }); },
        delete(ref) { ops.push(() => deletes.push(ref.path)); },
        async commit() { ops.forEach(op => op()); }
      };
    },
    runTransaction: async (_db, update) => {
      transactions.push(update);
      return update({
        get: async () => ({ exists: () => true, data: () => context.stored || vm.runInContext('night', context) }),
        set: (_ref, next) => { context.saved = next; context.stored = next; }
      });
    },
    doc: (parent, ...ids) => ({ id: ids.at(-1), path: [parent?.path, ...ids].filter(Boolean).join('/') }), collection: () => ({}), getDocs: async () => ({ docs: [] }), serverTimestamp: () => 'server-time',
    window: { matchMedia: () => ({ matches: reduceMotion }), prompt: () => null },
    location: { href: `https://example.test/${search}`, search, origin: 'https://example.test', pathname: '/' }, navigator: {}, confirm: () => true,
    createSpinPlan: wheel.createSpinPlan, spinAngle: wheel.spinAngle, WHEEL_THEMES: wheel.WHEEL_THEMES, themeKey: wheel.themeKey,
    // Stand-in renderer: records what the page asked the wheel to paint.
    CookieWheel: class {
      constructor() { this.draws = []; this.theme = 'cookie'; }
      setTheme(key) { this.theme = key; }
      // Array.from builds outer-realm arrays so deepEqual can compare them with the test literals.
      draw(tracks, angle = 0) { this.draws.push({ ids: Array.from(tracks, t => t.id), titles: Array.from(tracks, t => t.title), angle }); }
    }
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('attachListeners();');
  run(`night={...initialNight(),sessionId:'test',tracks:[
    {id:'a',title:'Chocolate Jam',creator:'Alice',status:'queued'},
    {id:'b',title:'Chocolate Jam',creator:'Bob',status:'queued'},
    {id:'c',title:'Played already',creator:'Carol',status:'closed'}
  ]}; authUser={uid:HOST_UIDS[0]}; hostVisible=true; eventRef={id:'event'};
    submissionsRef={path:'submissions'}; detailsRef={path:'songDetails'}; notesRef={path:'hostNotes'}; hostsRef={path:'config/hosts'}; votesRef={path:'votes'};`);
  return {
    run, context, elements, timers, transactions, deletes, sets,
    get clock() { return clock; },
    get lastDraw() { return run('cookieWheel').draws.at(-1); },
    toasts: () => elements.get('toastArea').children.map(c => c.textContent),
    pendingFrames: () => frames.slice(frameCursor).filter(f => !f.cancelled).length,
    // Runs every animation frame queued so far, once.
    frame() {
      const due = frames.slice(frameCursor); frameCursor = frames.length;
      let ran = 0;
      for (const f of due) if (!f.cancelled) { f.fn(clock); ran++; }
      return ran;
    },
    // Moves the fake clock forward and fires timers as they come due.
    advance(ms) {
      clock += ms;
      let fired = 0;
      for (;;) {
        const next = timers.filter(t => t.at <= clock).sort((x, y) => x.at - y.at)[0];
        if (!next) return fired;
        timers.splice(timers.indexOf(next), 1); next.fn(); fired++;
      }
    },
    async settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); }
  };
}

// Puts the fixture into a spinning round whose stored target is track 'b' (index 1, centred offset).
function spinningFixture(h, { startedAt = h.clock } = {}) {
  const plan = wheel.createSpinPlan([{ id: 'a', title: 'Alice' }, { id: 'b', title: 'Bob' }],
    startedAt, fixedRandom([1, 0x80000000]));
  h.context.plan = plan;
  h.run(`night={...night,...plan,phase:'spinning',spinId:'spin-1'};`);
  return plan;
}

test('the native cookie wheel replaces the embed in the main stage', () => {
  const panel = html.slice(html.indexOf('id="wheelPanel"'), html.indexOf('id="livePanel"'));
  assert.match(panel, /<canvas id="wheelCanvas" width="720" height="720"/);
  assert.ok(panel.indexOf('id="wheelCanvas"') < panel.indexOf('id="spinButton"'), 'spin button sits under the wheel');
  assert.doesNotMatch(html, /<iframe|externalWheel|originalWheelFrame|postMessage|wheelofnames\.com|WHEEL_URL/);
  assert.doesNotMatch(html, /\.wheel-shell|\.wheel-disc|\.wheel-pointer|\.wheel-center|external-wheel/);
  assert.match(html, /from '\.\/cookie-wheel\.mjs'/);
  assert.match(html, /\.native-cookie-wheel\{[^}]*max-width:560px/);
  assert.match(html, /\.native-cookie-wheel canvas\{[^}]*width:100%/);
  assert.match(html, /id="songLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /projectId: '[^']*"/, 'Firebase project ID has no stray quote');
  for (const file of ['public/assets/chocolate-chip-cookie.jpg', 'public/vendor/wheel-of-names/LICENSE', 'public/vendor/wheel-of-names/NOTICE.txt']) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
});

test('random index rejects unusable counts and resamples biased words', () => {
  for (const bad of [0, 201, 2.5, '3']) assert.throws(() => wheel.randomIndex(bad), /Invalid/);
  // With 3 entries the top word would favour index 0, so it is discarded and the next word used.
  assert.equal(wheel.randomIndex(3, fixedRandom([0xFFFFFFFF, 7])), 1);
  assert.equal(wheel.randomIndex(1, fixedRandom([0xFFFFFFFF])), 0);
  const counts = new Array(5).fill(0);
  for (let i = 0; i < 5000; i++) counts[wheel.randomIndex(5)]++;
  assert.ok(counts.every(c => c > 800 && c < 1200), `roughly uniform: ${counts}`);
});

test('spin plans land inside the chosen slice for every queue size up to 200', () => {
  let checks = 0;
  for (let count = 1; count <= 200; count++) {
    const tracks = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, creator: 'x', url: 'https://example.test', status: 'queued' }));
    const sector = TAU / count;
    for (let k = 0; k < count; k++) {
      for (const offsetWord of [0, 0x80000000, 0xFFFFFFFF]) {
        const plan = wheel.createSpinPlan(tracks, 123, fixedRandom([k, offsetWord]));
        // The painter centres slice k at -k*sector and rotates the wheel by the angle; the pointer sits at 0.
        let d = ((plan.spinFinalAngle - k * sector) % TAU + TAU) % TAU;
        if (d > Math.PI) d -= TAU;
        assert.ok(Math.abs(d) <= sector * 0.35 + 1e-9, `count ${count} index ${k} offset ${offsetWord}`);
        assert.equal(wheel.indexAtPointer(plan.spinFinalAngle, count), k);
        assert.equal(plan.spinTargetId, `t${k}`);
        checks++;
      }
    }
    const plan = wheel.createSpinPlan(tracks, 123, fixedRandom([0, 0]));
    assert.deepEqual(plan.spinTracks[0], { id: 't0', title: 'Song 0' }, 'frozen entries carry only id and title');
    assert.equal(plan.spinTracks.length, count);
    assert.equal(plan.spinStartedAt, 123);
    assert.equal(plan.spinDurationMs, wheel.SPIN_DURATION_MS);
    assert.ok(plan.spinFinalAngle >= TAU * 7 - sector / 2, 'at least seven full turns');
  }
  assert.equal(checks, 60300);
});

test('the shared animation eases out from rest to the stored final angle', () => {
  const plan = { spinStartedAt: 1000, spinDurationMs: 10000, spinFinalAngle: 50 };
  assert.equal(wheel.spinAngle(plan, 1000), 0);
  assert.equal(wheel.spinAngle(plan, 0), 0);
  assert.equal(wheel.spinAngle(plan, 11000), 50);
  assert.equal(wheel.spinAngle(plan, 99999), 50);
  let previous = 0;
  for (let t = 1000; t <= 11000; t += 10) {
    const angle = wheel.spinAngle(plan, t);
    assert.ok(angle >= previous, `monotonic at ${t}`);
    previous = angle;
  }
  assert.ok(wheel.spinAngle(plan, 6000) > 40, 'most of the travel happens early');
});

test('a host spin stores one shared plan for every viewer', async () => {
  const h = harness();
  h.run('render();');
  assert.equal(h.elements.get('spinButton').hidden, false);
  assert.equal(h.elements.get('spinButton').disabled, false);
  await h.run('spin();');
  const saved = h.context.saved;
  assert.equal(saved.phase, 'spinning');
  assert.match(saved.spinId, /^[0-9a-f-]{36}$/);
  assert.equal(saved.currentId, '');
  assert.deepEqual(Array.from(saved.spinTracks), [{ id: 'a', title: 'Alice' }, { id: 'b', title: 'Bob' }]);
  assert.ok(['a', 'b'].includes(saved.spinTargetId));
  assert.equal(saved.spinStartedAt, h.clock);
  assert.equal(saved.spinDurationMs, wheel.SPIN_DURATION_MS);
  assert.equal(wheel.indexAtPointer(saved.spinFinalAngle, 2), saved.spinTracks.findIndex(t => t.id === saved.spinTargetId));
  assert.equal(h.elements.get('wheelPanel').scrolled, true);
  assert.ok(h.toasts().includes('The cookie wheel is spinning!'));
  // The initiating host animates the stored plan right away, before the snapshot echoes it.
  assert.deepEqual(h.lastDraw, { ids: ['a', 'b'], titles: TITLES, angle: 0 });
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 10s');
  assert.equal(h.pendingFrames(), 1);
});

test('viewers watch the queue on the wheel and cannot start a spin', async () => {
  const h = harness();
  h.run(`authUser={uid:'viewer'};hostVisible=false;render();`);
  assert.equal(h.elements.get('spinButton').hidden, true);
  assert.deepEqual(h.lastDraw, { ids: ['a', 'b'], titles: TITLES, angle: 0 });
  await h.run('spin();');
  assert.equal(h.context.saved, undefined);
  assert.equal(h.transactions.length, 0);
});

test('every client animates the same frozen plan and viewers never write', async () => {
  const h = harness();
  h.run(`authUser={uid:'viewer'};hostVisible=false;`);
  const plan = spinningFixture(h);
  h.run('render();');
  assert.deepEqual(h.lastDraw, { ids: ['a', 'b'], titles: TITLES, angle: 0 });
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 10s');
  h.advance(2500);
  assert.equal(h.frame(), 1);
  assert.equal(h.lastDraw.angle, wheel.spinAngle(plan, h.clock));
  assert.ok(h.lastDraw.angle > 0 && h.lastDraw.angle < plan.spinFinalAngle);
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 8s');
  // Queue edits by a host mid-spin do not change the wheel that is already turning.
  h.run(`night.tracks.push({id:'d',title:'Late entry',status:'queued'});render();`);
  assert.deepEqual(h.lastDraw.ids, ['a', 'b']);
  assert.equal(h.lastDraw.angle, wheel.spinAngle(plan, h.clock));
  h.advance(7500);
  assert.equal(h.lastDraw.angle, plan.spinFinalAngle);
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 Selecting the next song…');
  await h.settle();
  assert.equal(h.context.saved, undefined);
  assert.equal(h.transactions.length, 0);
  assert.equal(h.pendingFrames(), 0);
  assert.equal(h.timers.length, 0);
});

test('the host opens voting for the persisted target when the spin completes', async () => {
  const h = harness();
  spinningFixture(h);
  h.run('render();');
  h.advance(9999);
  h.frame();
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 1s');
  assert.equal(h.context.saved, undefined);
  h.advance(1);
  await h.settle();
  const saved = h.context.saved;
  assert.equal(saved.phase, 'voting');
  assert.equal(saved.currentId, 'b');
  assert.equal(saved.spinId, 'spin-1');
  assert.equal(saved.tracks.find(t => t.id === 'b').status, 'live');
  assert.equal(saved.tracks.find(t => t.id === 'a').status, 'queued');
  assert.equal(h.transactions.length, 1);
  assert.ok(h.toasts().includes('Now playing: Chocolate Jam'));
  // A late frame or a second completion call never confirms the same round twice.
  h.frame();
  await h.run('finishCookieSpin();');
  await h.settle();
  assert.equal(h.transactions.length, 1);
  h.run('night=saved;render();');
  assert.equal(h.elements.get('wheelPanel').hidden, true);
  assert.equal(h.elements.get('livePanel').hidden, false);
  assert.equal(h.elements.get('songTitle').textContent, 'Chocolate Jam');
  assert.equal(h.elements.get('songCreator').textContent, 'submitted by Bob');
});

test('a timer completes the spin when the browser pauses animation frames', async () => {
  const h = harness();
  spinningFixture(h);
  h.run('render();');
  assert.equal(h.pendingFrames(), 1);
  assert.ok(h.advance(wheel.SPIN_DURATION_MS) >= 1, 'the completion timer fired');
  await h.settle();
  assert.equal(h.context.saved.phase, 'voting');
  assert.equal(h.context.saved.currentId, 'b');
  assert.equal(h.pendingFrames(), 0);
});

test('reduced motion shows the final position with a countdown and no animation frames', async () => {
  const h = harness({ reduceMotion: true });
  const plan = spinningFixture(h);
  h.run('render();');
  assert.equal(h.lastDraw.angle, plan.spinFinalAngle);
  assert.equal(h.pendingFrames(), 0);
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 10s');
  h.advance(1000);
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 9s');
  assert.equal(h.pendingFrames(), 0);
  h.advance(9000);
  await h.settle();
  assert.equal(h.context.saved.phase, 'voting');
});

test('a page that loads mid-spin resumes the plan and an expired plan finalizes at once', async () => {
  const h = harness();
  const plan = spinningFixture(h, { startedAt: h.clock - 4000 });
  h.run('render();');
  assert.equal(h.lastDraw.angle, wheel.spinAngle(plan, h.clock));
  assert.ok(h.lastDraw.angle > 0);
  assert.equal(h.elements.get('spinCountdown').textContent, '🍪 6s');
  assert.equal(h.context.saved, undefined);
  const late = harness();
  const expired = spinningFixture(late, { startedAt: late.clock - 12000 });
  late.run('render();');
  assert.equal(late.lastDraw.angle, expired.spinFinalAngle);
  await late.settle();
  assert.equal(late.context.saved.phase, 'voting');
  assert.equal(late.context.saved.currentId, 'b');
});

test('a viewer whose clock runs behind the host still sees the wheel move', () => {
  const h = harness();
  h.run(`authUser={uid:'viewer'};hostVisible=false;`);
  const plan = spinningFixture(h, { startedAt: h.clock + 3000 }); // the host clock is three seconds ahead
  h.run('render();');
  assert.equal(h.lastDraw.angle, 0);
  h.advance(1000);
  h.frame();
  assert.equal(wheel.spinAngle(plan, h.clock), 0, 'the raw plan would still be at rest');
  assert.equal(h.lastDraw.angle, wheel.spinAngle({ ...plan, spinStartedAt: h.clock - 1000 }, h.clock));
  assert.ok(h.lastDraw.angle > 0);
});

test('an old spinning round without a stored plan is confirmed manually', async () => {
  const h = harness();
  h.run(`night={...night,phase:'spinning',spinId:'legacy'};render();`);
  assert.deepEqual(h.lastDraw, { ids: ['a', 'b'], titles: TITLES, angle: 0 });
  assert.equal(h.pendingFrames(), 0);
  assert.equal(h.timers.length, 0);
  assert.equal(h.elements.get('spinButton').disabled, true);
  assert.match(h.elements.get('manualWinner').innerHTML, /value="a"[\s\S]*value="b"/);
  h.elements.get('manualWinner').value = 'b';
  h.run('render();');
  assert.equal(h.elements.get('manualPickButton').disabled, false);
  await h.run(`setWinner($('manualWinner').value);`);
  assert.equal(h.context.saved.phase, 'voting');
  assert.equal(h.context.saved.currentId, 'b');
});

test('two hosts cannot confirm different rounds', async () => {
  // Another host already confirmed this exact round: finish quietly, write nothing.
  const h = harness();
  spinningFixture(h);
  h.run('render();');
  h.run(`globalThis.stored={...structuredClone(night),phase:'voting',currentId:'b',tracks:night.tracks.map(t=>t.id==='b'?{...t,status:'live'}:t)};`);
  h.advance(wheel.SPIN_DURATION_MS);
  await h.settle();
  assert.equal(h.transactions.length, 1);
  assert.equal(h.context.saved, undefined);
  assert.deepEqual(h.toasts().filter(t => t.startsWith('Could not')), []);
  // A newer spin replaced this one before its result was confirmed.
  const h2 = harness();
  spinningFixture(h2);
  h2.run('render();');
  h2.run(`globalThis.stored={...structuredClone(night),spinId:'spin-2'};`);
  h2.advance(wheel.SPIN_DURATION_MS);
  await h2.settle();
  assert.equal(h2.context.saved, undefined);
  assert.deepEqual(h2.toasts().filter(t => t.startsWith('Could not')), []);
  // A manual confirmation against the stale round is refused with a visible error.
  await h2.run(`guarded(()=>setWinner('a'));`);
  assert.ok(h2.toasts().some(t => t.includes('The spin changed')), h2.toasts().join(' | '));
  assert.equal(h2.context.saved, undefined);
});

test('another host starting a spin prevents a duplicate spin', async () => {
  const h = harness();
  h.run(`globalThis.stored={...structuredClone(night),phase:'spinning',spinId:'other-host-spin'};`);
  await h.run('spin();');
  assert.equal(h.context.saved, undefined);
  assert.ok(h.toasts().includes('Another host already started this round.'));
});

test('host mutations retain newer edits from another host', async () => {
  const h = harness();
  h.run(`globalThis.stored={...structuredClone(night),title:'Renamed by another host'};stored.tracks.push({id:'d',title:'New song',status:'queued'});`);
  await h.run(`mutate(s=>s.tracks.push({id:'e',title:'My song',status:'queued'}));`);
  assert.equal(h.context.saved.title, 'Renamed by another host');
  assert.deepEqual(Array.from(h.context.saved.tracks, t => t.id), ['a', 'b', 'c', 'd', 'e']);
});

test('multiple listed hosts are allowed, unlisted accounts are not', () => {
  const h = harness();
  h.run(`HOST_UIDS.push('second-host');authUser={uid:'second-host'};render();`);
  assert.equal(h.run('isHost()'), true);
  assert.equal(h.elements.get('spinButton').hidden, false);
  h.run(`authUser={uid:'unlisted'};`);
  assert.equal(h.run('isHost()'), false);
  h.run('authUser=null;');
  assert.equal(h.run('isHost()'), false);
});

test('client and Firestore host lists agree', () => {
  const h = harness();
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const list = rules.match(/request\.auth\.uid in \[([\s\S]*?)\]/)[1];
  const uids = Array.from(list.matchAll(/'([^']+)'/g), match => match[1]);
  assert.deepEqual(Array.from(h.run('HOST_UIDS')), uids);
});

test('MozartAI song links survive adding, importing, and opening', async () => {
  const link = 'https://mozartai.com/s/okdRDz5tiTw8';
  const h = harness();
  assert.equal(h.run(`validTrack('Song','alice','${link}').url`), link);
  assert.equal(h.run(`safeUrl('${link}')`), link);
  assert.throws(() => h.run(`validTrack('Song','alice','javascript:alert(1)')`), /https:\/\//);
  h.elements.get('addTitle').value = 'Cosmic Cookies';
  h.elements.get('addCreator').value = 'alice';
  h.elements.get('addURL').value = link;
  await h.elements.get('addTrackForm').listeners.submit({ preventDefault() {} });
  assert.equal(h.context.saved.tracks.at(-1).url, link);
  assert.equal(h.elements.get('addTrackForm').wasReset, true);
  h.elements.get('bulkTracks').value = `Midnight Jam | bob | ${link}\nNo link song | carol`;
  await h.elements.get('importButton').listeners.click();
  assert.deepEqual(h.context.saved.tracks.slice(-2).map(t => [t.title, t.creator, t.url]),
    [['Midnight Jam', 'bob', link], ['No link song', 'carol', '']]);
  h.run(`night={...saved,phase:'voting',currentId:saved.tracks.at(-2).id};night.tracks=night.tracks.map(t=>t.id===night.currentId?{...t,status:'live'}:t);render();`);
  assert.equal(h.elements.get('songLink').hidden, false);
  assert.equal(h.elements.get('songLink').href, link);
  assert.equal(h.elements.get('songTitle').textContent, 'Midnight Jam');
});

// Browser pieces the Discord login touches, recorded for the assertions.
function loginHarness({ search = '' } = {}) {
  const h = harness();
  const store = new Map(), calls = { assigned: [], replaced: [], callable: [], tokens: [], signOuts: 0, snapshots: 0 };
  Object.assign(h.context, {
    location: { origin: 'https://cookie-sessions.web.app', pathname: '/', search, hash: '', href: `https://cookie-sessions.web.app/${search}`, assign: url => calls.assigned.push(url) },
    history: { replaceState: (_s, _t, url) => calls.replaced.push(url) },
    sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    httpsCallable: (_functions, name) => async data => { calls.callable.push({ name, data: { ...data } }); return { data: { token: 'firebase-token' } }; },
    signInWithCustomToken: async (_auth, token) => { calls.tokens.push(token); },
    signOut: async () => { calls.signOuts++; },
    onSnapshot: () => { calls.snapshots++; return () => {}; }
  });
  return { h, store, calls };
}
const member = (uid, discordName) => ({ uid, getIdTokenResult: async () => ({ claims: { member: true, discordName } }) });

test('Log in with Discord sends members to Discord and back with a one-time code', async () => {
  assert.match(html, /<section id="loginGate"[\s\S]*<button id="discordLogin"[\s\S]*<div id="app" class="app-wrap" hidden>/);
  assert.doesNotMatch(html, /hostDialog|signInAnonymously|signInWithEmailAndPassword|id="nickname"|id="submitNickname"/);
  const { h, store, calls } = loginHarness();
  h.run('startDiscordLogin();');
  const url = new URL(calls.assigned[0]);
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), h.run('DISCORD_CLIENT_ID'));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://cookie-sessions.web.app/');
  assert.equal(url.searchParams.get('scope'), 'identify guilds.members.read');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), store.get('cookie_login_state'));
  // Discord sends the browser back; the page trades the code for a Firebase session and cleans the address bar.
  const back = loginHarness({ search: '?code=abc&state=s1' });
  back.store.set('cookie_login_state', 's1');
  await back.h.run('finishDiscordLogin();');
  assert.deepEqual(back.calls.replaced, ['https://cookie-sessions.web.app/']);
  assert.deepEqual(back.calls.callable, [{ name: 'discordLogin', data: { code: 'abc', redirectUri: 'https://cookie-sessions.web.app/' } }]);
  assert.deepEqual(back.calls.tokens, ['firebase-token']);
  assert.equal(back.store.has('cookie_login_state'), false);
  assert.equal(back.h.run('loginPending'), false);
  // A forged or stale return and a cancelled consent never reach the login function.
  const forged = loginHarness({ search: '?code=abc&state=evil' });
  forged.store.set('cookie_login_state', 's1');
  await assert.rejects(forged.h.run('finishDiscordLogin();'), /wrong turn/);
  const cancelled = loginHarness({ search: '?error=access_denied&state=s1' });
  await assert.rejects(cancelled.h.run('finishDiscordLogin();'), /cancelled/);
  assert.deepEqual([...forged.calls.callable, ...cancelled.calls.callable], []);
  // A normal visit without a code leaves everything alone.
  const plain = loginHarness();
  await plain.h.run('finishDiscordLogin();');
  assert.deepEqual(plain.calls.replaced, []);
});

test('only Discord members see the app, and the host list decides host controls', async () => {
  const { h, calls } = loginHarness();
  await h.run('onAuthChange(null);');
  assert.equal(h.elements.get('loginGate').hidden, false);
  assert.equal(h.elements.get('app').hidden, true);
  // The Discord app and hosts are configured, so the login button is ready and no setup warning shows.
  assert.equal(h.run('configured'), true);
  assert.equal(h.elements.get('loginStatus').textContent, '');
  assert.equal(h.elements.get('discordLogin').disabled, false);
  assert.equal(h.elements.get('discordLogin').hidden, false);
  // A session from the old anonymous or email sign-in has no member claim and is signed out.
  h.context.old = { uid: 'anon', getIdTokenResult: async () => ({ claims: {} }) };
  await h.run('onAuthChange(old);');
  assert.equal(calls.signOuts, 1);
  assert.equal(h.elements.get('app').hidden, true);
  // A member gets the app under their server name; no host controls.
  h.context.dave = member('111', 'dave');
  await h.run('onAuthChange(dave);');
  assert.equal(h.elements.get('loginGate').hidden, true);
  assert.equal(h.elements.get('app').hidden, false);
  assert.equal(h.elements.get('userName').textContent, 'dave');
  assert.equal(h.run('myName'), 'dave');
  assert.equal(h.elements.get('hostToggle').hidden, true);
  assert.equal(h.elements.get('hostPanel').hidden, true);
  assert.equal(calls.snapshots, 2, 'the co-host list and the event listeners start once signed in');
  // A listed host sees the controls, can hide them, and can bring them back.
  h.context.host = member(h.run('HOST_UIDS[0]'), 'baker');
  await h.run('onAuthChange(host);');
  assert.equal(h.elements.get('hostToggle').hidden, false);
  assert.equal(h.elements.get('hostPanel').hidden, false);
  h.elements.get('hostLogout').listeners.click();
  assert.equal(h.elements.get('hostPanel').hidden, true);
  await h.elements.get('hostToggle').listeners.click();
  assert.equal(h.elements.get('hostPanel').hidden, false);
  // Log out goes through Firebase; the auth listener then shows the gate again.
  await h.elements.get('logoutButton').listeners.click();
  assert.equal(calls.signOuts, 2);
});

test('Firestore rules admit only Discord members and stamp their Discord name', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /request\.auth\.token\.firebase\.sign_in_provider == 'custom'\s*&& request\.auth\.token\.member == true/);
  assert.match(rules, /function isOwner\(\) \{\s*return isSignedIn\(\) && request\.auth\.uid in \[/);
  assert.match(rules, /function isHost\(\) \{\s*return isOwner\(\) \|\| \(isSignedIn\(\)\s*&& exists\(\/databases\/\$\(database\)\/documents\/config\/hosts\)/);
  assert.match(rules, /v\.nickname == request\.auth\.token\.discordName/);
  assert.match(rules, /s\.nickname == request\.auth\.token\.discordName/);
  assert.doesNotMatch(rules, /'[A-Za-z0-9]{28}'/, 'no Firebase account ids from the old email sign-in remain');
  // No project key in the page: Firebase Hosting serves the web settings at a reserved address.
  assert.doesNotMatch(html, /AIza[0-9A-Za-z_-]{35}/);
  assert.match(html, /const FIREBASE_INIT = '\/__\/firebase\/init\.json';[\s\S]*await fetch\(FIREBASE_INIT\)[\s\S]*initializeApp\(config\)/);
});

// A community submission as its two Firestore documents look to the page: the public one (who)
// and the private song details (what), readable only by the submitter and the hosts.
const FAN = { sessionId: 'test', userId: 'u1', trackId: 'sub_u1', nickname: 'dave', createdAt: 1, updatedAt: 1 };
const FAN_SONG = { sessionId: 'test', userId: 'u1', trackId: 'sub_u1', title: 'Fan Song', url: 'https://suno.com/song/abc', genre: 'Synthwave', comment: 'Turn it up' };

test('community submissions join the queue, the wheel, the host list, and the chart', async () => {
  assert.match(html, /<form id="submitForm">[\s\S]*id="submitURL" type="url" required[\s\S]*id="submitGenre"[^>]*list="genreList"[\s\S]*id="submitComment"[\s\S]*<\/form>/);
  assert.match(html, /<div id="standings"[\s\S]*id="standingsRows"/);
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  h.run('submissions=[fan];details=[fanSong];render();');
  assert.deepEqual(Array.from(h.run('queued().map(t=>t.id)')), ['a', 'b', 'sub_u1']);
  assert.deepEqual(h.lastDraw, { ids: ['a', 'b', 'sub_u1'], titles: ['Alice', 'Bob', 'dave'], angle: 0 });
  assert.match(h.elements.get('queueList').innerHTML, /Fan Song[\s\S]*COMMUNITY[\s\S]*dave · Synthwave[\s\S]*Turn it up/);
  assert.match(h.elements.get('submissionsState').textContent, /open · 1 received/);
  await h.run('spin();');
  assert.deepEqual(Array.from(h.context.saved.spinTracks, t => t.id), ['a', 'b', 'sub_u1']);
  // The host confirms the community song: its status lives in trackStatus, host tracks stay untouched.
  h.run(`night={...saved,spinTargetId:'sub_u1'};`);
  await h.run(`setWinner('sub_u1', night.spinId);`);
  let saved = h.context.saved;
  assert.equal(saved.phase, 'voting');
  assert.equal(saved.currentId, 'sub_u1');
  assert.equal(saved.trackStatus.sub_u1, 'live');
  assert.deepEqual({ ...saved.revealed.sub_u1 }, { title: 'Fan Song', url: 'https://suno.com/song/abc', genre: 'Synthwave', comment: 'Turn it up' });
  assert.ok(saved.tracks.every(t => t.status !== 'live'));
  // Viewers cannot read the song details; the revealed copy in the event shows them the live song.
  h.run(`night=saved;details=[];authUser={uid:'viewer'};hostVisible=false;render();`);
  assert.equal(h.elements.get('songTitle').textContent, 'Fan Song');
  assert.equal(h.elements.get('songCreator').textContent, 'submitted by dave');
  assert.equal(h.elements.get('songGenre').hidden, false);
  assert.equal(h.elements.get('songGenre').textContent, 'Synthwave');
  assert.equal(h.elements.get('songComment').textContent, '“Turn it up”');
  assert.equal(h.elements.get('songLink').href, 'https://suno.com/song/abc');
  h.run(`details=[fanSong];authUser={uid:HOST_UIDS[0]};hostVisible=true;`);
  await h.run('closeVoting();');
  saved = h.context.saved;
  assert.equal(saved.trackStatus.sub_u1, 'closed');
  assert.equal(saved.phase, 'between', 'host tracks are still queued');
  h.run('night=saved;render();');
  assert.equal(h.elements.get('standings').hidden, false);
  assert.equal(h.elements.get('standingsTitle').textContent, 'STANDINGS AFTER 2 TRACKS');
  assert.match(h.elements.get('standingsRows').innerHTML, /Fan Song/);
  assert.match(h.run(`csvString(enriched().board,'x')`), /"Creator","Genre","Comment"[\s\S]*"Fan Song","dave","Synthwave","Turn it up"/);
});

test('before a song plays, everyone else sees only who submitted it', async () => {
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  const secrets = /Fan Song|suno\.com|Synthwave|Turn it up/;
  // A viewer's page never receives other people's song details; it shows the submitter's name.
  h.run(`submissions=[fan];details=[];authUser={uid:'viewer'};hostVisible=false;render();`);
  assert.deepEqual(h.lastDraw.titles, ['Alice', 'Bob', 'dave']);
  assert.match(h.elements.get('wheelLabels').innerHTML, /dave/);
  assert.doesNotMatch(JSON.stringify(h.run('allTracks()')), secrets);
  // The host's spin plan in the public event document carries names only.
  h.run(`details=[fanSong];authUser={uid:HOST_UIDS[0]};hostVisible=true;render();`);
  await h.run('spin();');
  assert.deepEqual(Array.from(h.context.saved.spinTracks, t => t.title), ['Alice', 'Bob', 'dave']);
  assert.doesNotMatch(JSON.stringify(h.context.saved), secrets);
  // Viewers' pages ask only for their own song details; hosts ask for all of them.
  const queries = [];
  Object.assign(h.context, {
    query: (ref, ...filters) => ({ ref, filters }), where: (...w) => w.join(' '),
    onSnapshot: (q) => { queries.push(q); return () => {}; }
  });
  h.run(`authUser={uid:'viewer'};subscribeVotes('test');`);
  assert.deepEqual(Array.from(queries.find(q => q.ref?.path === 'songDetails').filters), ['sessionId == test', 'userId == viewer']);
  queries.length = 0;
  h.run(`authUser={uid:HOST_UIDS[0]};subscribeVotes('test');`);
  assert.deepEqual(Array.from(queries.find(q => q.ref?.path === 'songDetails').filters), ['sessionId == test']);
  // The rules hold the line: the public entry has no song fields; the details are private.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /hasOnly\(\['sessionId','userId','trackId','nickname','createdAt','updatedAt'\]\)/);
  assert.match(rules, /match \/songDetails\/\{submissionId\} \{[\s\S]*?allow read: if isHost\(\) \|\| \(isSignedIn\(\) && resource\.data\.userId == request\.auth\.uid\);/);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/events\/main\/songDetails\/\$\(submissionId\)\)/);
});

test('submitters cannot rate their own song but everyone else can', async () => {
  const h = harness();
  h.context.fan = FAN;
  h.run(`submissions=[fan];night={...night,phase:'voting',currentId:'sub_u1',trackStatus:{sub_u1:'live'}};authUser={uid:'u1'};hostVisible=false;render();`);
  assert.equal(h.elements.get('ratingSlider').disabled, true);
  assert.equal(h.elements.get('submitVote').disabled, true);
  assert.match(h.elements.get('voteMessage').textContent, /your own song/);
  await h.run(`myName='dave';vote();`);
  assert.equal(h.context.saved, undefined);
  h.run(`authUser={uid:'u2'};activeTrackId='';render();`);
  assert.equal(h.elements.get('ratingSlider').disabled, false);
  assert.equal(h.elements.get('submitVote').disabled, false);
  await h.run(`myName='erin';vote();`);
  assert.equal(h.context.saved.trackId, 'sub_u1');
  assert.equal(h.context.saved.nickname, 'erin');
  assert.equal(h.context.saved.userId, 'u2');
  assert.equal(h.context.savedRef.id, 'test_sub_u1_u2');
  // The rules enforce the same restriction server-side.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /v\.trackId != 'sub_' \+ request\.auth\.uid/);
});

test('a visitor submits one song, edits it, and withdraws it while it is queued', async () => {
  const h = harness();
  h.run(`authUser={uid:'u2'};myName='erin';hostVisible=false;render();`);
  assert.equal(h.elements.get('submitBadge').textContent, 'SUBMISSIONS OPEN');
  assert.equal(h.elements.get('submitAs').textContent, 'Submitting as erin');
  assert.equal(h.elements.get('submitButton').disabled, false);
  assert.equal(h.elements.get('withdrawButton').hidden, true);
  const submit = h.elements.get('submitForm').listeners.submit;
  const set = (id, value) => { h.elements.get(id).value = value; };
  set('submitTitle', 'Night Drive'); set('submitURL', 'http://suno.com/song/x');
  set('submitGenre', 'Synthwave'); set('submitComment', 'Made in one night');
  await submit({ preventDefault() {} });
  assert.equal(h.context.saved, undefined, 'http links are refused');
  assert.ok(h.toasts().some(t => t.includes('https://')));
  set('submitURL', 'https://suno.com/song/x');
  await submit({ preventDefault() {} });
  // One batch writes the public entry (who) and the private song (what) under the same id.
  assert.deepEqual(h.sets.map(x => x.ref.path), ['songDetails/test_u2', 'submissions/test_u2']);
  assert.deepEqual({ ...h.sets[0].data }, {
    sessionId: 'test', userId: 'u2', trackId: 'sub_u2', title: 'Night Drive', url: 'https://suno.com/song/x',
    genre: 'Synthwave', comment: 'Made in one night'
  });
  assert.deepEqual({ ...h.context.saved, createdAt: 0, updatedAt: 0 }, {
    sessionId: 'test', userId: 'u2', trackId: 'sub_u2', nickname: 'erin', createdAt: 0, updatedAt: 0
  });
  assert.equal(h.context.saved.createdAt, h.clock);
  assert.equal(h.context.saved.updatedAt, h.clock);
  // The snapshots arrive; the form shows the entry and allows edits that keep createdAt.
  h.context.mine = { ...h.context.saved }; h.context.mineSong = { ...h.sets[0].data };
  h.run('submissions=[mine];details=[mineSong];submitDirty=false;render();');
  assert.equal(h.elements.get('submitTitle').value, 'Night Drive');
  assert.equal(h.elements.get('submitButton').textContent, 'Update my song ↗');
  assert.equal(h.elements.get('withdrawButton').hidden, false);
  assert.match(h.elements.get('submitNote').textContent, /edit or withdraw/);
  h.advance(5000);
  set('submitTitle', 'Night Drive (final mix)');
  await submit({ preventDefault() {} });
  assert.equal(h.sets.at(-2).data.title, 'Night Drive (final mix)');
  assert.equal(h.context.saved.createdAt, h.context.mine.createdAt);
  assert.equal(h.context.saved.updatedAt, h.clock);
  await h.elements.get('withdrawButton').listeners.click();
  assert.deepEqual(h.deletes, ['submissions/test_u2', 'songDetails/test_u2']);
  // Once played, the entry is locked; while paused, nobody can submit.
  h.run(`night={...night,trackStatus:{sub_u2:'closed'}};render();`);
  assert.equal(h.elements.get('submitButton').disabled, true);
  assert.equal(h.elements.get('withdrawButton').hidden, true);
  assert.match(h.elements.get('submitNote').textContent, /has been played/);
  h.run(`night={...night,trackStatus:{},submissionsOpen:false};submissions=[];render();`);
  assert.equal(h.elements.get('submitBadge').textContent, 'SUBMISSIONS PAUSED');
  assert.equal(h.elements.get('submitTitle').disabled, true);
  assert.match(h.elements.get('submitNote').textContent, /paused/);
});

test('hosts can pause submissions and remove a community song', async () => {
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  h.run('submissions=[fan];details=[fanSong];render();');
  assert.match(h.elements.get('queueList').innerHTML, /Fan Song/, 'hosts see the song to moderate it');
  await h.elements.get('toggleSubmissions').listeners.click();
  assert.equal(h.context.saved.submissionsOpen, false);
  assert.ok(h.toasts().includes('Community submissions are paused.'));
  h.run('night=saved;render();');
  assert.equal(h.elements.get('toggleSubmissions').textContent, 'Open submissions');
  assert.match(h.elements.get('submissionsState').textContent, /paused/);
  // Removing a community song marks it in trackStatus instead of touching the submission document.
  h.elements.get('queueList').listeners.click({ target: { closest: sel => sel === '[data-remove]' ? { dataset: { remove: 'sub_u1' } } : null } });
  await h.settle();
  assert.equal(h.context.saved.trackStatus.sub_u1, 'removed');
  assert.deepEqual(h.deletes, []);
  h.run('night=saved;render();');
  assert.deepEqual(Array.from(h.run('queued().map(t=>t.id)')), ['a', 'b']);
  assert.doesNotMatch(h.elements.get('queueList').innerHTML, /Fan Song/);
  h.run(`authUser={uid:'u1'};hostVisible=false;render();`);
  assert.match(h.elements.get('submitNote').textContent, /removed your submission/);
  assert.equal(h.elements.get('submitButton').disabled, true);
});

test('hosts can finish the evening early and start a fresh one', async () => {
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  // Finishing is refused mid-round.
  h.run(`submissions=[fan];details=[fanSong];night={...night,phase:'voting',currentId:'a',tracks:night.tracks.map(t=>t.id==='a'?{...t,status:'live'}:t)};render();`);
  assert.equal(h.elements.get('finishButton').disabled, true);
  await h.run('guarded(finishNight);');
  assert.ok(h.toasts().some(t => t.includes('Close the current round')));
  assert.equal(h.context.saved, undefined);
  // Between songs it ends the night, closes submissions, and shows the final panel.
  h.run(`night={...night,phase:'between',currentId:'',tracks:night.tracks.map(t=>t.id==='a'?{...t,status:'closed'}:t),trackStatus:{sub_u1:'closed'}};render();`);
  assert.equal(h.elements.get('finishButton').disabled, false);
  h.elements.get('finishButton').listeners.click();
  await h.settle();
  assert.equal(h.context.saved.phase, 'finished');
  assert.equal(h.context.saved.submissionsOpen, false);
  assert.equal(h.context.saved.currentId, '');
  h.run('night=saved;render();');
  assert.equal(h.elements.get('endPanel').hidden, false);
  assert.equal(h.elements.get('submitBadge').textContent, 'EVENING OVER');
  assert.equal(h.elements.get('finishButton').disabled, true);
  // Starting over archives the night with its community songs, deletes their documents, and opens a new jar.
  h.elements.get('newNightName').value = 'Saturday Encore';
  h.elements.get('newNightButton').listeners.click();
  await h.settle();
  const archive = h.sets.find(s => s.ref.id === 'test');
  assert.equal(archive.data.title, 'Tonight’s Cookie Playback');
  assert.ok(Array.from(archive.data.tracks).some(t => t.id === 'sub_u1' && t.genre === 'Synthwave'));
  const fresh = h.sets.find(s => s.ref.id === 'event').data;
  assert.equal(fresh.title, 'Saturday Encore');
  assert.notEqual(fresh.sessionId, 'test');
  assert.equal(fresh.phase, 'ready');
  assert.equal(fresh.tracks.length, 0);
  assert.equal(fresh.submissionsOpen, true);
  assert.equal(Object.keys(fresh.trackStatus).length, 0);
  assert.deepEqual(h.deletes, ['submissions/test_u1', 'songDetails/test_u1']);
  assert.ok(h.toasts().includes('Fresh evening ready. Submissions are open.'));
  assert.equal(h.elements.get('newNightName').value, '');
});

test('the last queued song plays without a spin', async () => {
  const h = harness();
  h.run(`night={...night,phase:'between',tracks:night.tracks.map(t=>t.id==='b'?{...t,status:'closed'}:t)};render();`);
  assert.equal(h.elements.get('spinButton').textContent, '▶ Play the last song');
  assert.equal(h.elements.get('spinButton').disabled, false);
  assert.equal(h.elements.get('wheelHeadline').textContent, 'The last cookie in the jar');
  assert.match(h.elements.get('wheelSubtitle').textContent, /Only Alice’s song is left\. Play it below/);
  await h.run('spin();');
  const saved = h.context.saved;
  assert.equal(saved.phase, 'voting');
  assert.equal(saved.currentId, 'a');
  assert.equal(saved.tracks.find(t => t.id === 'a').status, 'live');
  assert.match(saved.spinId, /^[0-9a-f-]{36}$/);
  assert.equal(saved.spinTracks, undefined, 'no wheel plan is written');
  assert.ok(h.toasts().some(t => t === 'Last song! Now playing: Chocolate Jam'));
  assert.equal(h.elements.get('livePanel').hidden, false);
  assert.equal(h.elements.get('livePanel').scrolled, true);
  // A lone community song takes the same shortcut through trackStatus; viewers see neutral wording.
  const c = harness();
  c.context.fan = FAN;
  c.run(`submissions=[fan];night={...night,phase:'between',tracks:night.tracks.map(t=>({...t,status:'closed'}))};authUser={uid:'v'};hostVisible=false;render();`);
  assert.match(c.elements.get('wheelSubtitle').textContent, /The host plays it without a spin/);
  c.run(`authUser={uid:HOST_UIDS[0]};hostVisible=true;render();`);
  assert.equal(c.elements.get('spinButton').textContent, '▶ Play the last song');
  await c.run('spin();');
  assert.equal(c.context.saved.phase, 'voting');
  assert.equal(c.context.saved.currentId, 'sub_u1');
  assert.equal(c.context.saved.trackStatus.sub_u1, 'live');
  // With two or more songs the wheel still spins.
  const d = harness();
  d.run('render();');
  assert.equal(d.elements.get('spinButton').textContent, '🍪 Spin the cookie!');
});

test('equal averages share a rank and the final screen shows co-champions', () => {
  const h = harness();
  h.run(`night={...night,phase:'finished',tracks:[
    {id:'a',title:'Chocolate Jam',creator:'Alice',status:'closed'},
    {id:'b',title:'Night Drive',creator:'Bob',status:'closed'},
    {id:'c',title:'Played already',creator:'Carol',status:'closed'},
    {id:'d',title:'Slow Burn',creator:'Dana',status:'closed'}
  ]};votes=[
    {sessionId:'test',trackId:'a',userId:'u1',scoreHalf:16},{sessionId:'test',trackId:'a',userId:'u2',scoreHalf:16},
    {sessionId:'test',trackId:'b',userId:'u3',scoreHalf:15},{sessionId:'test',trackId:'b',userId:'u4',scoreHalf:17},
    {sessionId:'test',trackId:'d',userId:'u5',scoreHalf:14}
  ];render();`);
  const board = Array.from(h.run('enriched().board'), t => [t.id, t.rank, t.tied]);
  assert.deepEqual(board, [['a', 1, true], ['b', 1, true], ['d', 3, false], ['c', null, false]]);
  const rows = h.elements.get('leaderRows').innerHTML;
  assert.equal((rows.match(/leader-item first/g) || []).length, 2);
  assert.equal((rows.match(/leader-tie/g) || []).length, 2);
  const champion = h.elements.get('champion').innerHTML;
  assert.match(champion, /IT’S A TIE · 2 TOP COOKIES/);
  assert.match(champion, /Chocolate Jam[\s\S]*Night Drive/);
  assert.match(champion, /8\.00 <small>\/10 each/);
  const csv = h.run(`csvString(enriched().board,'x')`);
  assert.match(csv, /"Rank","Tie","Song"/);
  assert.match(csv, /"1","TIE","Chocolate Jam"[\s\S]*"1","TIE","Night Drive"[\s\S]*"3","","Slow Burn"[\s\S]*"","","Played already"/);
  // One clear winner keeps the single-champion screen and no markers.
  h.run(`votes=votes.filter(v=>!(v.trackId==='b' && v.userId==='u4'));render();`);
  assert.deepEqual(Array.from(h.run('enriched().board'), t => [t.id, t.rank, t.tied]), [['a', 1, false], ['b', 2, false], ['d', 3, false], ['c', null, false]]);
  assert.match(h.elements.get('champion').innerHTML, /TONIGHT'S TOP COOKIE[\s\S]*Chocolate Jam/);
  assert.doesNotMatch(h.elements.get('leaderRows').innerHTML, /leader-tie/);
});

test('hosts pick the wheel look for everyone, and a new evening keeps it', async () => {
  // Every theme has its picture and a credit line.
  const credits = fs.readFileSync(path.join(root, 'public/assets/IMAGE-CREDITS.md'), 'utf8');
  for (const [key, theme] of Object.entries(wheel.WHEEL_THEMES)) {
    assert.ok(fs.existsSync(path.join(root, 'public/assets', theme.file)), `${key}: ${theme.file} exists`);
    assert.ok(credits.includes(theme.file), `${key}: ${theme.file} is credited`);
  }
  const h = harness();
  h.run('render();');
  const picker = h.elements.get('wheelTheme');
  assert.match(picker.innerHTML, /value="cookie"[\s\S]*value="pumpkin"[\s\S]*Halloween pumpkin[\s\S]*value="vinyl"[\s\S]*value="christmas"[\s\S]*value="donut"[\s\S]*value="pizza"/);
  assert.equal(picker.value, 'cookie');
  assert.equal(h.run('cookieWheel.theme'), 'cookie');
  await picker.listeners.change({ target: { value: 'pumpkin' } });
  await h.settle();
  assert.equal(h.context.saved.wheelTheme, 'pumpkin');
  h.run('night=saved;render();');
  assert.equal(h.run('cookieWheel.theme'), 'pumpkin', 'every page paints the stored look');
  assert.equal(h.elements.get('recordInner').textContent, '🎃');
  await picker.listeners.change({ target: { value: '<script>' } });
  await h.settle();
  assert.equal(h.context.saved.wheelTheme, 'cookie', 'unknown looks are stored as the cookie');
  h.run(`night={...night,wheelTheme:'pumpkin'};`);
  await h.run('makeNewNight();');
  assert.equal(h.sets.find(x => x.ref.id === 'event').data.wheelTheme, 'pumpkin');
});

test('hosts pre-listen to any song and keep shared notes that come back when it plays', async () => {
  const h = harness();
  h.context.fan = { ...FAN, }; h.context.fanSong = { ...FAN_SONG, url: 'https://mozartai.com/s/in63aYs1lNAR' };
  const lookups = [];
  h.run('functions={};');
  Object.assign(h.context, {
    httpsCallable: (_f, name) => async data => { lookups.push([name, data.url]); return { data: { title: 'Seasons', artist: 'C', cover: 'https://mozart-assets.b-cdn.net/c.png?token=t', audio: 'https://mozart-assets.b-cdn.net/a.mp3?token=t', duration: 200 } }; }
  });
  h.run(`submissions=[fan];details=[fanSong];myName='baker';render();`);
  assert.match(h.elements.get('queueList').innerHTML, /data-listen="sub_u1"/);
  // Opening a MozartAI song loads its audio and cover into the pre-listen card.
  h.elements.get('queueList').listeners.click({ target: { closest: sel => sel === '[data-listen]' ? { dataset: { listen: 'sub_u1' } } : null } });
  await h.settle();
  assert.equal(h.elements.get('prelistenCard').hidden, false);
  assert.equal(h.elements.get('prelistenTitle').textContent, 'Fan Song');
  assert.equal(h.elements.get('prelistenMeta').textContent, 'dave · Synthwave');
  assert.deepEqual(lookups, [['mozartLookup', 'https://mozartai.com/s/in63aYs1lNAR']]);
  assert.equal(h.elements.get('prelistenAudio').src, 'https://mozart-assets.b-cdn.net/a.mp3?token=t');
  assert.equal(h.elements.get('prelistenAudio').hidden, false);
  assert.equal(h.elements.get('prelistenCover').hidden, false);
  assert.equal(h.elements.get('noteMeta').textContent, 'No note yet');
  // A note is saved for all hosts under the host's Discord name.
  h.elements.get('noteText').value = '  Big chorus at 1:40, mention the guitar.  ';
  await h.elements.get('saveNote').listeners.click();
  assert.equal(h.context.savedRef.path, 'hostNotes/test_sub_u1');
  assert.deepEqual({ ...h.context.saved, updatedAt: 0 }, { sessionId: 'test', trackId: 'sub_u1', text: 'Big chorus at 1:40, mention the guitar.', editedBy: 'baker', editedById: h.run('HOST_UIDS[0]'), updatedAt: 0 });
  h.context.note = { ...h.context.saved };
  h.run('notes=[note];render();');
  assert.equal(h.elements.get('noteMeta').textContent, 'Saved by baker');
  assert.match(h.elements.get('queueList').innerHTML, /title="Has host notes">NOTE/);
  // Another host's edit shows up unless this host is typing.
  h.run(`notes=[{...note,text:'Changed by the co-host',editedBy:'cohost'}];noteDirty=true;render();`);
  assert.equal(h.elements.get('noteText').value, 'Big chorus at 1:40, mention the guitar.', 'an edit while typing does not overwrite the box');
  assert.equal(h.elements.get('noteMeta').textContent, 'Saved by cohost');
  // Non-MozartAI songs offer the link instead of a player.
  h.elements.get('queueList').listeners.click({ target: { closest: sel => sel === '[data-listen]' ? { dataset: { listen: 'a' } } : null } });
  await h.settle();
  assert.equal(h.elements.get('prelistenAudio').hidden, true);
  assert.equal(h.elements.get('prelistenStatus').textContent, 'This song has no link.');
  // When the song plays, the note is in the host's live panel and nowhere for viewers.
  h.run(`night={...night,phase:'voting',currentId:'sub_u1',trackStatus:{sub_u1:'live'},revealed:{sub_u1:{title:'Fan Song',url:fanSong.url,genre:'',comment:''}}};render();`);
  assert.equal(h.elements.get('liveNote').hidden, false);
  assert.equal(h.elements.get('liveNoteText').textContent, 'Changed by the co-host');
  h.run(`authUser={uid:'viewer'};hostVisible=false;activeTrackId='';render();`);
  assert.equal(h.elements.get('liveNote').hidden, true);
  // Clearing the text removes the note; a new evening deletes the old notes.
  h.run(`authUser={uid:HOST_UIDS[0]};hostVisible=true;prelistenId='sub_u1';noteDirty=false;`);
  h.elements.get('noteText').value = ' ';
  await h.elements.get('saveNote').listeners.click();
  assert.ok(h.deletes.includes('hostNotes/test_sub_u1'));
  await h.run('makeNewNight();');
  assert.ok(h.deletes.filter(d => d === 'hostNotes/test_sub_u1').length === 2);
  // Rules: only hosts, shared, stamped with the editor's Discord name.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/hostNotes\/\{noteId\} \{[\s\S]*?allow read, delete: if isHost\(\);[\s\S]*?editedBy == request\.auth\.token\.discordName/);
});

test('a playing MozartAI song shows its cover turning on the record', async () => {
  const h = harness();
  let resolve;
  h.run('functions={};');
  Object.assign(h.context, { httpsCallable: () => () => new Promise(r => { resolve = r; }) });
  h.run(`night={...night,phase:'voting',currentId:'a',tracks:night.tracks.map(t=>t.id==='a'?{...t,status:'live',url:'https://mozartai.com/s/in63aYs1lNAR'}:t)};render();`);
  const art = h.elements.get('recordArt'), img = h.elements.get('songCover');
  assert.equal(art.classList.contains('has-cover'), false);
  resolve({ data: { cover: 'https://mozart-assets.b-cdn.net/c.png?token=t' } });
  await h.settle();
  assert.equal(img.src, 'https://mozart-assets.b-cdn.net/c.png?token=t');
  img.onload();
  assert.equal(art.classList.contains('has-cover'), true);
  assert.equal(img.hidden, false);
  // The next song starts plain until its own cover arrives; a song without a MozartAI link stays plain.
  h.run(`night={...night,currentId:'b',tracks:night.tracks.map(t=>t.id==='a'?{...t,status:'closed'}:t.id==='b'?{...t,status:'live',url:'https://suno.com/song/x'}:t)};render();`);
  assert.equal(art.classList.contains('has-cover'), false);
  assert.equal(img.hidden, true);
  assert.equal(h.run(`MOZART_LINK.test('https://suno.com/song/x')`), false);
  assert.equal(h.run(`MOZART_LINK.test('https://mozartai.com/song/f68cfac3-486a-46f0-91e7-dde37687593e?utm_source=share')`), true);
});

test('the host area follows the evening: prepare, live show, wrap up', async () => {
  const h = harness();
  const panes = () => ['Prepare', 'Live', 'Wrap'].filter(id => !h.elements.get(`hostPane${id}`).hidden);
  h.run('render();');
  assert.deepEqual(panes(), ['Prepare'], 'a fresh evening opens on step 1');
  assert.equal(h.elements.get('hostCounts').textContent, '2 songs waiting · 1 played');
  assert.equal(h.elements.get('hostNext').textContent, 'Next: spin the wheel. 2 songs are waiting.');
  // The host can switch steps freely.
  h.elements.get('hostTabWrap').listeners.click({ currentTarget: { dataset: { tab: 'wrap' } } });
  assert.deepEqual(panes(), ['Wrap']);
  h.run('render();');
  assert.deepEqual(panes(), ['Wrap'], 'a re-render does not undo the choice');
  // Spinning from the host area is the same shared spin; the live step opens and tells the host what to do.
  await h.elements.get('hostSpin').listeners.click();
  assert.equal(h.context.saved.phase, 'spinning');
  h.run('night=saved;render();');
  assert.deepEqual(panes(), ['Live']);
  assert.equal(h.elements.get('hostNext').textContent, 'The wheel is turning…');
  h.run(`night={...night,phase:'voting',currentId:'a',tracks:night.tracks.map(t=>t.id==='a'?{...t,status:'live'}:t)};votes=[{sessionId:'test',trackId:'a',userId:'v1',scoreHalf:14}];render();`);
  assert.match(h.elements.get('hostNext').textContent, /^Now playing: “Chocolate Jam” · 1 votes so far/);
  assert.equal(h.elements.get('hostSpin').hidden, true);
  assert.equal(h.elements.get('closeButton').hidden, false);
  h.run(`night={...night,phase:'finished',currentId:''};render();`);
  assert.deepEqual(panes(), ['Wrap']);
  // Plain words in the controls.
  assert.match(html, /Download results \(spreadsheet\)/);
  assert.match(html, /<details class="host-more"><summary>The wheel stopped but voting did not open\?<\/summary>/);
});

test('hosts download every song with links and notes at any time, not only after the show', () => {
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  h.run(`night={...night,tracks:[...night.tracks,{id:'r',title:'Removed one',creator:'x',status:'removed'}]};submissions=[fan];details=[fanSong];
    notes=[{sessionId:'test',trackId:'sub_u1',text:'Big chorus',editedBy:'baker'}];render();`);
  assert.equal(h.elements.get('exportSongs').disabled, false);
  const csv = h.run('songsCsv()');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '"#","Song","Submitted by","Genre","Comment","Link","Added by","Status","Sent at","Host notes","Note saved by"');
  assert.match(lines[1], /^"1","Chocolate Jam","Alice","","","","Host","Waiting","","",""$/);
  assert.match(lines[3], /^"3","Played already","Carol",.*"Played"/);
  assert.match(lines[4], /^"4","Fan Song","dave","Synthwave","Turn it up","https:\/\/suno\.com\/song\/abc","Member","Waiting","[^"]+","Big chorus","baker"$/);
  assert.equal(lines.length, 5, 'removed songs are left out');
  assert.equal(csv[0], '﻿');
  // Nothing to download yet: the button is off.
  h.run(`night={...night,tracks:[]};submissions=[];render();`);
  assert.equal(h.elements.get('exportSongs').disabled, true);
});

test('oops buttons: re-open the round just closed, or skip the live song back into the jar', async () => {
  const h = harness();
  h.context.fan = FAN; h.context.fanSong = FAN_SONG;
  h.run(`submissions=[fan];details=[fanSong];night={...night,phase:'voting',currentId:'sub_u1',trackStatus:{sub_u1:'live'},revealed:{sub_u1:{title:'Fan Song',url:'',genre:'',comment:''}}};
    votes=[{sessionId:'test',trackId:'sub_u1',userId:'v1',nickname:'anna',scoreHalf:12},{sessionId:'test',trackId:'sub_u1',userId:'v2',nickname:'ben',scoreHalf:16}];render();`);
  assert.equal(h.elements.get('hostVoters').textContent, 'Voted: anna, ben · dave cannot rate their own song.');
  assert.equal(h.elements.get('putBackButton').hidden, false);
  assert.equal(h.elements.get('reopenButton').hidden, true);
  // Closed by mistake: re-open brings the same song and its votes back.
  await h.run('closeVoting();');
  assert.equal(h.context.saved.lastClosedId, 'sub_u1');
  h.run('night=saved;render();');
  assert.equal(h.elements.get('reopenButton').hidden, false);
  assert.equal(h.elements.get('reopenButton').textContent, '↩ Re-open voting for “Fan Song”');
  await h.elements.get('reopenButton').listeners.click();
  await h.settle();
  let saved = h.context.saved;
  assert.deepEqual([saved.phase, saved.currentId, saved.trackStatus.sub_u1, saved.lastClosedId], ['voting', 'sub_u1', 'live', '']);
  assert.equal(saved.revealed.sub_u1.title, 'Fan Song', 'the reveal is kept');
  // Broken link: skip puts the song back, private again, and clears its votes for a fresh round.
  h.run('night=saved;render();');
  h.elements.get('putBackButton').listeners.click();
  await h.settle();
  saved = h.context.saved;
  assert.equal(saved.phase, 'between', 'a song was already played tonight');
  assert.equal(saved.currentId, '');
  assert.equal('sub_u1' in saved.trackStatus, false);
  assert.equal('sub_u1' in saved.revealed, false);
  assert.deepEqual(h.deletes.sort(), ['votes/test_sub_u1_v1', 'votes/test_sub_u1_v2']);
  h.run('night=saved;render();');
  assert.ok(h.run('queued().some(t=>t.id==="sub_u1")'), 'the song can be picked again');
  assert.equal(h.elements.get('reopenButton').hidden, true);
  // Skipping a host track with nothing played yet returns to "ready".
  h.context.stored = undefined;
  h.run(`night={...initialNight(),sessionId:'test',phase:'voting',currentId:'a',tracks:[{id:'a',title:'A',status:'live'},{id:'b',title:'B',status:'queued'}]};votes=[];render();`);
  await h.run('putBackInJar();');
  assert.equal(h.context.saved.phase, 'ready');
  assert.equal(h.context.saved.tracks[0].status, 'queued');
  // Finishing the evening on purpose cannot be undone with re-open.
  h.context.stored = undefined;
  h.run(`night={...night,phase:'between',currentId:'',lastClosedId:'a',tracks:[{id:'a',title:'A',status:'closed'}]};`);
  await h.run('finishNight();');
  assert.equal(h.context.saved.lastClosedId, '');
});

test('hosts play a chosen song now, and hear it from the stage with its length and the voters', async () => {
  const h = harness();
  h.run('functions={};');
  h.context.httpsCallable = () => async () => ({ data: { cover: '', audio: 'https://mozart-assets.b-cdn.net/a.mp3?token=t', duration: 234.867 } });
  h.run(`night={...night,tracks:night.tracks.map(t=>t.id==='b'?{...t,url:'https://mozartai.com/s/in63aYs1lNAR'}:t)};prelistenId='b';render();`);
  assert.equal(h.elements.get('playNowButton').hidden, false);
  await h.elements.get('playNowButton').listeners.click();
  await h.settle();
  const saved = h.context.saved;
  assert.deepEqual([saved.phase, saved.currentId, saved.tracks.find(t => t.id === 'b').status], ['voting', 'b', 'live']);
  assert.equal(saved.spinTracks, undefined, 'no spin');
  h.run('night=saved;render();');
  await h.settle();
  assert.equal(h.elements.get('hostPlayer').hidden, false);
  assert.equal(h.elements.get('liveAudio').src, 'https://mozart-assets.b-cdn.net/a.mp3?token=t');
  assert.equal(h.elements.get('liveLength').textContent, 'Song length 3:55');
  h.run('render();');
  assert.match(h.elements.get('hostNext').textContent, /0 votes so far\. Song length 3:55\. Close voting/);
  assert.equal(h.elements.get('hostVoters').textContent, 'No votes yet.');
  assert.equal(h.elements.get('playNowButton').hidden, true, 'not while a song is playing');
  // Members get no player.
  h.run(`authUser={uid:'viewer'};hostVisible=false;activeTrackId='';render();`);
  await h.settle();
  assert.equal(h.elements.get('hostPlayer').hidden, true);
});

test('a host message shows at the top of every screen until removed', async () => {
  const h = harness();
  h.run('render();');
  assert.equal(h.elements.get('banner').hidden, true);
  h.elements.get('bannerInput').value = '  10-minute break, back at 21:30  ';
  await h.elements.get('bannerShow').listeners.click();
  await h.settle();
  assert.equal(h.context.saved.banner, '10-minute break, back at 21:30');
  h.run(`night=saved;authUser={uid:'viewer'};hostVisible=false;render();`);
  assert.equal(h.elements.get('banner').hidden, false);
  assert.equal(h.elements.get('bannerText').textContent, '10-minute break, back at 21:30');
  h.run(`authUser={uid:HOST_UIDS[0]};hostVisible=true;render();`);
  assert.equal(h.elements.get('bannerClear').hidden, false);
  await h.elements.get('bannerClear').listeners.click();
  await h.settle();
  assert.equal(h.context.saved.banner, '');
});

test('owners add and remove co-hosts in the app; co-hosts host right away but cannot change the list', async () => {
  const h = harness();
  h.run('myName="Callandra";render();');
  assert.match(h.elements.get('teamList').innerHTML, /👑 <b>Callandra<\/b> · owner[\s\S]*👑 <b>yanti<\/b> · owner/);
  assert.equal(h.elements.get('teamForm').hidden, false);
  const add = async (id, name) => { h.elements.get('teamId').value = id; h.elements.get('teamName').value = name; await h.elements.get('teamForm').listeners.submit({ preventDefault() {} }); await h.settle(); };
  await add('12345', 'shorty');
  assert.ok(h.toasts().some(t => /17 to 20 digits/.test(t)));
  await add(h.run('HOST_UIDS[1]'), 'yanti');
  assert.ok(h.toasts().includes('This person is already a host.'));
  await add('222222222222222222', 'Pumpkin Pete');
  assert.equal(h.context.savedRef.path, 'config/hosts');
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.saved)), { ids: ['222222222222222222'], names: { '222222222222222222': 'Pumpkin Pete' }, updatedBy: 'Callandra' });
  // The co-host's page turns into a host page as soon as the list arrives.
  h.context.list = h.context.saved;
  h.run(`authUser={uid:'222222222222222222'};hostVisible=false;hostRoleWas=false;coHosts={ids:[],names:{}};applyHostRole();`);
  assert.equal(h.run('isHost()'), false);
  h.run(`coHosts={...list};applyHostRole();`);
  assert.equal(h.run('isHost()'), true);
  assert.equal(h.run('isOwner()'), false);
  assert.equal(h.elements.get('hostPanel').hidden, false);
  assert.equal(h.elements.get('hostToggle').hidden, false);
  assert.equal(h.elements.get('teamForm').hidden, true);
  assert.match(h.elements.get('teamNote').textContent, /Only the owners \(Callandra, yanti\)/);
  assert.doesNotMatch(h.elements.get('teamList').innerHTML, /data-cohost/, 'co-hosts get no remove buttons');
  // An owner removes them again.
  h.run(`authUser={uid:HOST_UIDS[0]};render();`);
  h.elements.get('teamList').listeners.click({ target: { closest: () => ({ dataset: { cohost: '222222222222222222' } }) } });
  await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.saved)), { ids: [], names: {}, updatedBy: 'Callandra' });
  // Rules: owners fixed in the file, co-hosts from config/hosts, only owners write the list.
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/config\/hosts \{[\s\S]*?allow read: if isSignedIn\(\);[\s\S]*?allow create, update: if isOwner\(\)/);
});

test('the screen-share view hides private and control parts but keeps the host player', async () => {
  for (const part of ['#hostPanel', '#liveNote', '#submitCard', '.vote-form', '.score-block', '#userName', '#logoutButton'])
    assert.ok(html.includes(`.stage-view ${part}`), `${part} is hidden in the screen-share view`);
  assert.ok(!html.includes('.stage-view #hostPlayer'));
  const h = harness({ search: '?view=stage' });
  assert.equal(h.run('STAGE_VIEW'), true);
  h.run(`hostRoleWas=null;applyHostRole();`);
  assert.equal(h.run('isHost()'), true);
  assert.equal(h.elements.get('hostPanel').hidden, true, 'no control room in the shared window');
  // The host opens it from the live step.
  const opened = [];
  const main = harness();
  main.context.window.open = (...args) => opened.push(args);
  main.elements.get('openStage').listeners.click();
  assert.deepEqual(opened, [['https://example.test/?view=stage', 'cookie-stage', 'popup,width=1280,height=760']]);
});

test('Firestore rules cover community submissions', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/submissions\/\{submissionId\}/);
  assert.match(rules, /s\.trackId == 'sub_' \+ request\.auth\.uid/);
  assert.match(rules, /submissionId == s\.sessionId \+ '_' \+ request\.auth\.uid/);
  assert.match(rules, /n\.get\('submissionsOpen', false\) == true/);
  assert.match(rules, /n\.phase != 'finished'/);
  assert.match(rules, /!\(s\.trackId in n\.get\('trackStatus', \{\}\)\)/);
  assert.match(rules, /s\.url\.matches\('https:\/\/\.\*'\)/);
  assert.match(rules, /request\.resource\.data\.createdAt == resource\.data\.createdAt/);
  assert.match(rules, /allow delete: if isHost\(\)/);
});

test('the original painter draws the queued titles at the shared angle', () => {
  const calls = [];
  function fakeCanvas(size = 720) {
    const canvas = { width: size, height: size };
    const values = {};
    const context = new Proxy({}, {
      get(_, name) {
        if (name === 'canvas') return canvas;
        if (name in values) return values[name];
        return (...args) => {
          calls.push([name, ...args]);
          if (name === 'measureText') return { width: String(args[0]).length * 10 };
          if (name === 'createRadialGradient') return { addColorStop() {} };
          if (name === 'getImageData') return { data: [0, 0, 0, 0] };
          return {};
        };
      },
      set(_, name, value) { values[name] = value; return true; }
    });
    canvas.getContext = () => context;
    return canvas;
  }
  const previous = { Image: globalThis.Image, document: globalThis.document };
  globalThis.Image = class { constructor() { this.naturalHeight = 0; this.width = 1; this.height = 1; } setAttribute() {} };
  globalThis.document = { createElement: () => fakeCanvas() };
  try {
    let repaints = 0;
    const cookieWheel = new wheel.CookieWheel(fakeCanvas(), () => repaints++);
    assert.match(cookieWheel.config.getCoverImage(), /\/public\/assets\/chocolate-chip-cookie\.jpg$/);
    assert.equal(cookieWheel.config.type, 'image');
    cookieWheel.draw([{ id: 'a', title: 'Chocolate Jam' }, { id: 'b', title: 'Midnight Jam Session Extended' }], 1.25);
    assert.ok(calls.some(c => c[0] === 'rotate' && c[1] === 1.25), 'wheel rotated by the shared angle');
    assert.deepEqual(calls.filter(c => c[0] === 'fillText').map(c => c[1].trim()), ['Chocolate Jam', 'Midnight Jam Sess…']);
    assert.ok(calls.some(c => c[0] === 'drawImage'), 'cover artwork drawn');
    calls.length = 0;
    cookieWheel.draw([], 0);
    assert.deepEqual(calls.filter(c => c[0] === 'fillText').map(c => c[1].trim()), ['Add songs to spin']);
    calls.length = 0;
    cookieWheel.draw([], 0.5);
    assert.equal(calls.filter(c => c[0] === 'fillText').length, 0, 'unchanged entries reuse the cached wheel image');
    assert.ok(calls.some(c => c[0] === 'rotate' && c[1] === 0.5));
    cookieWheel.setTheme('pumpkin');
    assert.match(cookieWheel.config.getCoverImage(), /\/public\/assets\/wheel-pumpkin\.jpg$/);
    cookieWheel.setTheme('no-such-theme');
    assert.match(cookieWheel.config.getCoverImage(), /chocolate-chip-cookie\.jpg$/, 'unknown themes fall back to the cookie');
  } finally {
    globalThis.Image = previous.Image;
    globalThis.document = previous.document;
  }
});

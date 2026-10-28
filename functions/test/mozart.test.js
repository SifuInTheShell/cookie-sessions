// Checks the MozartAI lookup against a fake MozartAI. Run: npm test (in functions/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mozartLink, mozartSong } from '../mozart.js';

const SONG = 'f68cfac3-486a-46f0-91e7-dde37687593e';
const ANSWER = [{ result: { data: { json: {
  songId: SONG, projectName: 'Seasons of the Soul', artist: 'Callandra', duration: 234.867,
  coverArt: 'https://mozart-assets.b-cdn.net/songs/x/coverArt/cover.png?token=t&expires=1',
  audioUrl: 'https://mozart-assets.b-cdn.net/projects/p/songs/x/audio/generated.mp3?token=t&expires=1'
} } } }];

function fakeMozart({ location = `https://mozartai.com/song/${SONG}?sh=in63aYs1lNAR`, status = 200, body = ANSWER } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://mozartai.com/s/')) return { status: 307, headers: new Headers(location ? { location } : {}) };
    return { ok: status === 200, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('share links and song pages are recognised; anything else is not', () => {
  assert.deepEqual(mozartLink('https://mozartai.com/s/in63aYs1lNAR'), { share: 'in63aYs1lNAR' });
  assert.deepEqual(mozartLink(`https://mozartai.com/song/${SONG}?utm_source=share`), { songId: SONG });
  assert.equal(mozartLink('http://mozartai.com/s/in63aYs1lNAR'), null);
  assert.equal(mozartLink('https://mozartai.com.evil.test/s/in63aYs1lNAR'), null);
  assert.equal(mozartLink('https://suno.com/song/abc'), null);
  assert.equal(mozartLink('https://mozartai.com/song/not-a-uuid'), null);
  assert.equal(mozartLink('not a link'), null);
});

test('a share link resolves through its redirect to cover art and audio', async () => {
  const mozart = fakeMozart();
  const song = await mozartSong('https://mozartai.com/s/in63aYs1lNAR', mozart.fetchImpl);
  assert.deepEqual(song, { title: 'Seasons of the Soul', artist: 'Callandra', cover: ANSWER[0].result.data.json.coverArt, audio: ANSWER[0].result.data.json.audioUrl, duration: 234.867 });
  assert.equal(mozart.calls[0].init.redirect, 'manual');
  const api = new URL(mozart.calls[1].url);
  assert.deepEqual(JSON.parse(api.searchParams.get('input')), { 0: { json: { projectId: SONG } } });
  // A song page link skips the redirect.
  const direct = fakeMozart();
  await mozartSong(`https://mozartai.com/song/${SONG}`, direct.fetchImpl);
  assert.equal(direct.calls.length, 1);
});

test('asset links outside MozartAI are dropped', async () => {
  const body = structuredClone(ANSWER);
  body[0].result.data.json.coverArt = 'https://evil.test/cover.png';
  const song = await mozartSong(`https://mozartai.com/song/${SONG}`, fakeMozart({ body }).fetchImpl);
  assert.equal(song.cover, '');
  assert.ok(song.audio);
});

test('unknown links and outages give clear errors', async () => {
  await assert.rejects(mozartSong('https://suno.com/song/abc', fakeMozart().fetchImpl), e => e.code === 'invalid-argument');
  await assert.rejects(mozartSong('https://mozartai.com/s/zzzzzzzz', fakeMozart({ location: 'https://mozartai.com/' }).fetchImpl), e => e.code === 'not-found');
  await assert.rejects(mozartSong(`https://mozartai.com/song/${SONG}`, fakeMozart({ status: 404 }).fetchImpl), e => e.code === 'not-found');
  await assert.rejects(mozartSong(`https://mozartai.com/song/${SONG}`, fakeMozart({ status: 500 }).fetchImpl), e => e.code === 'unavailable');
  await assert.rejects(mozartSong(`https://mozartai.com/song/${SONG}`, fakeMozart({ body: [{}] }).fetchImpl), e => e.code === 'not-found');
});

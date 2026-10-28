// MozartAI lookup: a song link gives its cover art and audio. MozartAI's own API only answers
// its own website, so the browser cannot ask it directly. The asset links it returns expire after
// a few hours, so they are looked up when needed and never stored.
import { HttpsError } from 'firebase-functions/v2/https';

const API = 'https://mozart-backend-api-92996263259.us-central1.run.app/trpc/discover.getProjectById';
const SONG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSETS = 'https://mozart-assets.b-cdn.net/';

// Accepts share links (mozartai.com/s/CODE) and song pages (mozartai.com/song/UUID).
export function mozartLink(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(www\.)?mozartai\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(s|song)\/([A-Za-z0-9-]{6,64})\/?$/);
  if (!m) return null;
  if (m[1] === 's') return { share: m[2] };
  return SONG_ID.test(m[2]) ? { songId: m[2] } : null;
}

export async function mozartSong(url, fetchImpl = fetch) {
  const link = mozartLink(url);
  if (!link) throw new HttpsError('invalid-argument', 'This is not a MozartAI song link.');
  let songId = link.songId;
  if (!songId) {
    // The share link answers with a redirect to the song page; its address holds the song id.
    const shared = await fetchImpl(`https://mozartai.com/s/${link.share}`, { redirect: 'manual' });
    songId = (shared.headers.get('location') || '').match(/\/song\/([0-9a-f-]{36})/i)?.[1];
    if (!songId || !SONG_ID.test(songId)) throw new HttpsError('not-found', 'MozartAI does not know this song link.');
  }
  const input = encodeURIComponent(JSON.stringify({ 0: { json: { projectId: songId } } }));
  const response = await fetchImpl(`${API}?batch=1&input=${input}`);
  if (response.status === 404) throw new HttpsError('not-found', 'MozartAI does not know this song link.');
  if (!response.ok) throw new HttpsError('unavailable', 'MozartAI is not answering right now.');
  const song = (await response.json())?.[0]?.result?.data?.json;
  if (!song) throw new HttpsError('not-found', 'MozartAI does not know this song link.');
  // Only hand out links to MozartAI's own file server.
  const asset = value => typeof value === 'string' && value.startsWith(ASSETS) ? value : '';
  return {
    title: String(song.projectName || '').slice(0, 200),
    artist: String(song.artist || song.userName || '').slice(0, 100),
    cover: asset(song.coverArt),
    audio: asset(song.audioUrl),
    duration: Number(song.duration) || 0
  };
}

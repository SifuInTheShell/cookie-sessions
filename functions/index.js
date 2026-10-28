// Cookie Sessions login backend: Discord does the authentication, Firebase gets a session for it.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { discordIdentity } from './discord.js';
import { mozartSong } from './mozart.js';

initializeApp();

// SETUP: set the secret with `firebase functions:secrets:set DISCORD_CLIENT_SECRET`;
// the two ids live in functions/.env (see .env.example).
const clientSecret = defineSecret('DISCORD_CLIENT_SECRET');
const clientId = defineString('DISCORD_CLIENT_ID');
const guildId = defineString('DISCORD_GUILD_ID');

// Keep this region identical to LOGIN_REGION in public/index.html.
export const discordLogin = onCall({ region: 'europe-west1', secrets: [clientSecret], maxInstances: 5 }, async request => {
  const { code, redirectUri } = request.data || {};
  if (typeof code !== 'string' || !code || code.length > 200 || typeof redirectUri !== 'string' || !/^https?:\/\//.test(redirectUri) || redirectUri.length > 300) {
    throw new HttpsError('invalid-argument', 'This login link is incomplete. Please log in again.');
  }
  // Discord itself refuses a redirect URI that is not registered for the app, so it needs no allow-list here.
  const who = await discordIdentity({ code, redirectUri, clientId: clientId.value(), clientSecret: clientSecret.value(), guildId: guildId.value() });
  // The Firebase uid is the Discord user id; hosts are listed by that id in index.html and firestore.rules.
  const token = await getAuth().createCustomToken(who.id, { member: true, discordName: who.name });
  return { token };
});

// Cover art and audio of a MozartAI song, for the spinning record on stage and the hosts' pre-listening.
// Members only, so this is no open proxy; answers are kept for half an hour (MozartAI's links last a few hours).
const mozartCache = new Map();
export const mozartLookup = onCall({ region: 'europe-west1', maxInstances: 5 }, async request => {
  if (request.auth?.token?.member !== true) throw new HttpsError('permission-denied', 'Please log in first.');
  const url = request.data?.url;
  if (typeof url !== 'string' || url.length > 300) throw new HttpsError('invalid-argument', 'This is not a MozartAI song link.');
  const hit = mozartCache.get(url);
  if (hit && hit.until > Date.now()) return hit.song;
  const song = await mozartSong(url);
  if (mozartCache.size > 500) mozartCache.clear();
  mozartCache.set(url, { song, until: Date.now() + 30 * 60 * 1000 });
  return song;
});

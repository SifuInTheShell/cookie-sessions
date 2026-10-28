// Checks the Discord login exchange against a fake Discord. Run: npm test (in functions/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordIdentity } from '../discord.js';

const SETTINGS = { code: 'abc', redirectUri: 'https://cookie-sessions.web.app/', clientId: 'client', clientSecret: 'secret', guildId: '42' };

// Answers the three Discord calls; `member` is the guild member body, or a number for an error status.
function fakeDiscord({ token = 200, user = { id: '1234567890', username: 'cookie_monster', global_name: 'Cookie Monster' }, member = { nick: 'Monster' } } = {}) {
  const calls = [];
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth2/token')) return reply(token, { access_token: 'discord-access' });
    if (url.endsWith('/users/@me')) return reply(200, user);
    if (url.endsWith('/users/@me/guilds/42/member')) return typeof member === 'number' ? reply(member, {}) : reply(200, member);
    throw Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test('a server member gets their Discord id and server nickname', async () => {
  const discord = fakeDiscord();
  assert.deepEqual(await discordIdentity(SETTINGS, discord.fetchImpl), { id: '1234567890', name: 'Monster' });
  const exchange = discord.calls[0];
  assert.equal(exchange.init.method, 'POST');
  assert.deepEqual(Object.fromEntries(exchange.init.body), {
    grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://cookie-sessions.web.app/', client_id: 'client', client_secret: 'secret'
  });
  assert.equal(discord.calls[2].init.headers.Authorization, 'Bearer discord-access');
});

test('the name falls back to the display name, then the username, and fits 32 characters', async () => {
  assert.equal((await discordIdentity(SETTINGS, fakeDiscord({ member: { nick: null } }).fetchImpl)).name, 'Cookie Monster');
  const plain = { id: '1234567890', username: 'cookie_monster', global_name: null };
  assert.equal((await discordIdentity(SETTINGS, fakeDiscord({ user: plain, member: {} }).fetchImpl)).name, 'cookie_monster');
  assert.equal((await discordIdentity(SETTINGS, fakeDiscord({ member: { nick: 'x'.repeat(40) } }).fetchImpl)).name.length, 32);
});

test('people outside the server are refused', async () => {
  await assert.rejects(discordIdentity(SETTINGS, fakeDiscord({ member: 404 }).fetchImpl),
    e => e.code === 'permission-denied' && /members of our Discord server/.test(e.message));
});

test('a rejected code and Discord outages give a retry message', async () => {
  await assert.rejects(discordIdentity(SETTINGS, fakeDiscord({ token: 400 }).fetchImpl), e => e.code === 'unauthenticated');
  await assert.rejects(discordIdentity(SETTINGS, fakeDiscord({ member: 500 }).fetchImpl), e => e.code === 'unavailable');
});

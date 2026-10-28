// Discord side of the login: trade the OAuth code for the member's identity on our server.
import { HttpsError } from 'firebase-functions/v2/https';

const API = 'https://discord.com/api/v10';

export async function discordIdentity({ code, redirectUri, clientId, clientSecret, guildId }, fetchImpl = fetch) {
  const tokenResponse = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret })
  });
  if (!tokenResponse.ok) throw new HttpsError('unauthenticated', 'Discord did not accept this login. Please try again.');
  const { access_token: accessToken } = await tokenResponse.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const userResponse = await fetchImpl(`${API}/users/@me`, { headers });
  if (!userResponse.ok) throw new HttpsError('unavailable', 'Discord is not answering right now. Please try again.');
  const user = await userResponse.json();

  // 404 means the account is not on our server; anything else is Discord having a bad moment.
  const memberResponse = await fetchImpl(`${API}/users/@me/guilds/${guildId}/member`, { headers });
  if (memberResponse.status === 404) throw new HttpsError('permission-denied', 'Cookie Sessions is for members of our Discord server. Join the server, then log in again.');
  if (!memberResponse.ok) throw new HttpsError('unavailable', 'Discord is not answering right now. Please try again.');
  const member = await memberResponse.json();

  // Server nickname first, then the global display name, then the username.
  const name = String(member.nick || user.global_name || user.username || '').trim().slice(0, 32) || `member-${user.id.slice(-4)}`;
  return { id: user.id, name };
}

// Works out who the player is and which room they're in.
// Inside Discord: authenticate with the Embedded App SDK; the room is the activity instance.
// In a plain browser: "dev mode" with a made-up player, room from ?room= (default "dev").

export function inDiscord() {
  return new URLSearchParams(location.search).has('frame_id');
}

export async function identify() {
  if (!inDiscord()) return devIdentity();

  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Token exchange failed');
  const { access_token } = await res.json();
  await sdk.commands.authenticate({ access_token });

  return { room: sdk.instanceId, hello: { accessToken: access_token } };
}

function devIdentity() {
  const params = new URLSearchParams(location.search);
  // sessionStorage is per tab, so each tab is a different player.
  let id = null;
  try { id = sessionStorage.getItem('settleon-dev-id'); } catch {}
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('settleon-dev-id', id); } catch {}
  }
  const name = params.get('name') || `Settler ${id.slice(0, 3).toUpperCase()}`;
  return { room: params.get('room') || 'dev', hello: { dev: { id, name } } };
}

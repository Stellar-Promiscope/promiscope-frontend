import { notFound } from 'next/navigation';
import { getPlayer } from '@/lib/contract';
import type { Player } from '@/types';
import PlayerProfileClient from './PlayerProfileClient';

// Cache the rendered profile so the Soroban RPC isn't hit on every request.
export const revalidate = 60;

/**
 * Player public profile. Fetches the player on the server so the initial
 * HTML contains the name, position and milestones (for crawlers, link
 * previews and a faster LCP); interactive parts live in PlayerProfileClient.
 * The JSON-LD block is rendered server-side by ./layout.tsx.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  let player: Player | null = null;
  try {
    player = (await getPlayer(params.id)) as Player | null;
  } catch (err) {
    // Contract error 3 (PlayerNotFound) — parseContractError maps it to
    // this message. Any other failure (e.g. RPC outage) falls back to the
    // client-side fetch instead of a false 404.
    if (err instanceof Error && err.message === 'Player not found') {
      notFound();
    }
  }

  return <PlayerProfileClient initialPlayer={player} />;
}

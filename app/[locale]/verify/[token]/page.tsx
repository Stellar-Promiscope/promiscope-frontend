import type { Metadata } from 'next';
import { getMilestoneHistory, getPlayer } from '@/lib/contract';
import { buildCvContent, canonicalizeCvContent } from '@/lib/cvVerification';
import { hashCanonicalCvContent, verifyCvToken } from '@/lib/cvSigning';
import type { Milestone, Player } from '@/types';

interface VerifyPageProps {
  params: { locale: string; token: string };
}

export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Verify Player CV | Promiscope',
  robots: { index: false, follow: false },
};

function Result({
  title,
  message,
  tone,
}: {
  title: string;
  message: string;
  tone: 'valid' | 'outdated' | 'invalid';
}) {
  const colors = {
    valid: 'border-green-500/40 bg-green-500/10 text-green-300',
    outdated: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
    invalid: 'border-red-500/40 bg-red-500/10 text-red-300',
  };

  return (
    <main className="mx-auto mt-20 max-w-xl px-6">
      <p className="mb-3 text-sm text-gray-400">Promiscope CV verification</p>
      <section className={`rounded-xl border p-6 ${colors[tone]}`}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6">{message}</p>
      </section>
    </main>
  );
}

export default async function VerifyPage({ params }: VerifyPageProps) {
  const signed = verifyCvToken(params.token);
  if (!signed) {
    return (
      <Result
        tone="invalid"
        title="Invalid CV"
        message="This verification token is not authentic or has been altered."
      />
    );
  }

  try {
    const player = (await getPlayer(signed.playerId)) as Player;
    const milestones = ((await getMilestoneHistory(signed.playerId)) as Milestone[]) ?? [];
    const currentHash = hashCanonicalCvContent(
      canonicalizeCvContent(buildCvContent(player, milestones)),
    );

    if (currentHash === signed.contentHash) {
      return (
        <Result
          tone="valid"
          title="Matches chain"
          message={`This CV is an authentic snapshot of ${player.vitals.name}'s on-chain player data.`}
        />
      );
    }

    const signedIds = new Set(signed.ledger.map((reference) => reference.milestoneId));
    const currentIds = new Set(milestones.map((milestone) => milestone.id));
    const hasOnlyNewMilestones =
      signedIds.size < currentIds.size &&
      Array.from(signedIds).every((id) => currentIds.has(id));

    if (hasOnlyNewMilestones) {
      return (
        <Result
          tone="outdated"
          title="Signed but outdated"
          message={`The signature is authentic, but ${player.vitals.name} has newer on-chain milestones than this CV.`}
        />
      );
    }
  } catch {
    return (
      <Result
        tone="invalid"
        title="Unable to verify"
        message="The signed data could not be checked against the current chain state."
      />
    );
  }

  return (
    <Result
      tone="invalid"
      title="Invalid CV"
      message="The signed player data no longer matches the on-chain record."
    />
  );
}

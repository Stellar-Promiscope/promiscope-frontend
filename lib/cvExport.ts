import type { Player, Milestone } from '@/types';
import type { PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';
import { getProgressLabel } from '@/lib/progress';
import { fetchAcademyForWallet } from '@/lib/api';
import {
  buildCvContent,
  hashCvContent,
} from '@/lib/cvVerification';

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

/**
 * Above this milestone count, `generatePlayerCvPdf` is a large enough job
 * that a caller should warn the user before starting rather than let the
 * "Generating…" state run silently (issue #1011) — pagination itself
 * (`ensureSpace`) already handles any length correctly, so this is purely
 * about setting user expectations for how long the wait will be, not a
 * hard cap: nothing is dropped or truncated at this threshold.
 */
export const CV_EXPORT_LARGE_MILESTONE_WARNING_THRESHOLD = 150;

/**
 * How many milestones `generatePlayerCvPdf` draws before yielding a
 * macrotask back to the event loop. The synchronous `drawText` loop over a
 * long milestone list can otherwise block the main thread for one
 * unbroken stretch; yielding periodically lets the browser process input,
 * paint the "Generating…" state, etc. in between chunks instead of only
 * after the whole PDF is built.
 */
const PDF_GENERATION_YIELD_INTERVAL = 40;

export interface CvVerification {
  token: string;
  url: string;
  contentHash: string;
}

/** Requests a server signature bound to the currently displayed chain data. */
export async function requestCvVerification(
  player: Player,
  milestones: Milestone[],
): Promise<CvVerification> {
  const contentHash = await hashCvContent(buildCvContent(player, milestones));
  const response = await fetch('/api/cv/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: player.id, contentHash }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'Unable to sign CV data');
  }

  const result = (await response.json()) as {
    token: string;
    contentHash: string;
  };
  if (result.contentHash !== contentHash) {
    throw new Error('The signed CV content does not match the exported content');
  }

  const locale = window.location.pathname.split('/')[1] || 'en';
  return {
    ...result,
    url: `${window.location.origin}/${locale}/verify/${result.token}`,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Builds a `playername-promiscope-cv.pdf`-style filename, safe for all filesystems. */
export function buildCvFilename(playerName: string): string {
  const slug = playerName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'player'}-promiscope-cv.pdf`;
}

/**
 * Caps how many `fetchAcademyForWallet` lookups run concurrently in
 * `resolveValidatorNames` (issue #1011). A handful — the common case of a
 * few distinct validators per player — completes in one batch either way;
 * this only bounds the fan-out for a player with an unusually long,
 * many-validator milestone history. No existing concurrency-limit
 * convention exists elsewhere in this codebase to mirror, so 5 is picked
 * directly: high enough that the common case (a handful of validators)
 * never waits on an extra batch round trip, low enough to not fire
 * hundreds of simultaneous requests at the backend for an outlier player.
 */
const VALIDATOR_LOOKUP_CONCURRENCY = 5;

/**
 * Resolves each unique validator wallet on the milestone list to a
 * human-readable name via the academy lookup (same source ValidatorChip
 * uses), falling back to a truncated address when a validator isn't
 * registered under an academy. Runs in bounded-concurrency batches rather
 * than firing every lookup at once — see `VALIDATOR_LOOKUP_CONCURRENCY`.
 */
async function resolveValidatorNames(
  milestones: Milestone[],
): Promise<Record<string, string>> {
  const uniqueAddresses = Array.from(
    new Set(milestones.map((m) => m.validator)),
  );
  const entries: (readonly [string, string])[] = [];
  for (
    let i = 0;
    i < uniqueAddresses.length;
    i += VALIDATOR_LOOKUP_CONCURRENCY
  ) {
    const batch = uniqueAddresses.slice(i, i + VALIDATOR_LOOKUP_CONCURRENCY);
    const batchEntries = await Promise.all(
      batch.map(async (address) => {
        const academy = await fetchAcademyForWallet(address);
        return [address, academy?.name ?? truncateAddress(address)] as const;
      }),
    );
    entries.push(...batchEntries);
  }
  return Object.fromEntries(entries);
}

/**
 * Generates a one-or-more-page CV PDF for a player: vitals, progress level,
 * stats, and a chronological milestone list with resolved validator names.
 * Runs entirely client-side via a dynamically-imported pdf-lib so the
 * library stays out of the main bundle.
 */
export async function generatePlayerCvPdf(
  player: Player,
  milestones: Milestone[],
  verification?: CvVerification,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const validatorNames = await resolveValidatorNames(milestones);

  const doc = await PDFDocument.create();
  if (verification) {
    doc.setSubject(`Promiscope verification token: ${verification.token}`);
    doc.setKeywords([verification.token, verification.contentHash]);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const INK = rgb(0.07, 0.09, 0.15);
  const MUTED = rgb(0.42, 0.45, 0.5);
  const GREEN = rgb(0, 0.78, 0.33);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(height: number) {
    if (y - height < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawText(
    text: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      gapAfter?: number;
    } = {},
  ) {
    const size = opts.size ?? 11;
    const gapAfter = opts.gapAfter ?? 4;
    ensureSpace(size + gapAfter);
    page.drawText(text, {
      x: MARGIN,
      y,
      size,
      font: opts.font ?? font,
      color: opts.color ?? INK,
    });
    y -= size + gapAfter;
  }

  drawText('Promiscope — Player CV', {
    size: 11,
    font: boldFont,
    color: GREEN,
    gapAfter: 18,
  });

  drawText(player.vitals.name, { size: 24, font: boldFont, gapAfter: 4 });
  drawText(
    `${player.vitals.position} · ${player.vitals.region} · Age ${player.vitals.age} · ${player.vitals.nationality}`,
    { size: 11, color: MUTED, gapAfter: 20 },
  );

  drawText('Progress Level', { size: 13, font: boldFont, gapAfter: 6 });
  drawText(
    `${getProgressLabel(player.progressLevel)} (Level ${player.progressLevel} of 3)`,
    { size: 11, gapAfter: 20 },
  );

  if (player.stats) {
    drawText('Stats', { size: 13, font: boldFont, gapAfter: 6 });
    const statLines = [
      `Goals: ${player.stats.goals}`,
      `Assists: ${player.stats.assists}`,
      `Appearances: ${player.stats.appearances}`,
    ];
    if (player.vitals.position === 'GK') {
      statLines.push(`Clean Sheets: ${player.stats.clean_sheets ?? 0}`);
    }
    drawText(statLines.join('   ·   '), { size: 11, gapAfter: 20 });
  }

  drawText('Milestone History', { size: 13, font: boldFont, gapAfter: 8 });

  if (milestones.length === 0) {
    drawText('No milestones recorded yet.', { size: 11, color: MUTED });
  } else {
    const chronological = [...milestones].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    for (let i = 0; i < chronological.length; i++) {
      const milestone = chronological[i];
      ensureSpace(36);
      drawText(milestone.description, { size: 11, gapAfter: 2 });
      const date = new Date(milestone.timestamp * 1000).toLocaleDateString();
      const validatorName =
        validatorNames[milestone.validator] ??
        truncateAddress(milestone.validator);
      drawText(`Validated by ${validatorName} · ${date}`, {
        size: 9,
        color: MUTED,
        gapAfter: 14,
      });

      if (
        i > 0 &&
        i % PDF_GENERATION_YIELD_INTERVAL === 0 &&
        i < chronological.length - 1
      ) {
        await yieldToEventLoop();
      }
    }
  }

  ensureSpace(65);
  if (verification) {
    const qrDataUrl = await QRCode.toDataURL(verification.url, {
      width: 52,
      margin: 1,
    });
    const qrImage = await doc.embedPng(qrDataUrl);
    page.drawImage(qrImage, { x: MARGIN, y: y - 52, width: 52, height: 52 });
    page.drawText('Verify this CV', {
      x: MARGIN + 62,
      y: y - 14,
      size: 9,
      font: boldFont,
      color: INK,
    });
    page.drawText(verification.url, {
      x: MARGIN + 62,
      y: y - 30,
      size: 7,
      font,
      color: MUTED,
      maxWidth: PAGE_WIDTH - MARGIN * 2 - 62,
    });
    page.drawText(`Token: ${verification.token.slice(0, 24)}…`, {
      x: MARGIN + 62,
      y: y - 44,
      size: 7,
      font,
      color: MUTED,
      maxWidth: PAGE_WIDTH - MARGIN * 2 - 62,
    });
    y -= 60;
  }
  drawText(`Generated ${new Date().toLocaleDateString()} · promiscope.example`, {
    size: 8,
    color: MUTED,
  });

  return doc.save();
}

/** Triggers a browser download of the generated PDF bytes. */
export function downloadPlayerCvPdf(
  bytes: Uint8Array,
  playerName: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildCvFilename(playerName);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayerStatsCard from '@/components/player/PlayerStatsCard';
import type { PlayerStats } from '@/types';

describe('PlayerStatsCard', () => {
  it('renders a loading skeleton when stats is undefined', () => {
    render(<PlayerStatsCard />);
    const skeleton = screen.getByLabelText('Loading player stats');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Player Stats')).not.toBeInTheDocument();
  });

  it('renders goals, assists and appearances for a non-GK position', () => {
    const stats: PlayerStats = { goals: 12, assists: 5, appearances: 20 };
    render(<PlayerStatsCard stats={stats} position="ST" />);

    expect(screen.getByText('Player Stats')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Assists')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Appearances')).toBeInTheDocument();
  });

  it('does not render the Clean Sheets stat for a non-GK position', () => {
    const stats: PlayerStats = { goals: 1, assists: 1, appearances: 1 };
    render(<PlayerStatsCard stats={stats} position="ST" />);
    expect(screen.queryByText('Clean sheets')).not.toBeInTheDocument();
  });

  it('does not render the Clean Sheets stat when position is omitted', () => {
    const stats: PlayerStats = { goals: 1, assists: 1, appearances: 1 };
    render(<PlayerStatsCard stats={stats} />);
    expect(screen.queryByText('Clean sheets')).not.toBeInTheDocument();
  });

  it('renders the Clean Sheets stat for a GK position', () => {
    const stats: PlayerStats = {
      goals: 0,
      assists: 0,
      appearances: 10,
      clean_sheets: 4,
    };
    render(<PlayerStatsCard stats={stats} position="GK" />);
    expect(screen.getByText('Clean sheets')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('defaults Clean Sheets to 0 for a GK with an undefined clean_sheets value', () => {
    const stats: PlayerStats = { goals: 0, assists: 0, appearances: 10 };
    render(<PlayerStatsCard stats={stats} position="GK" />);
    expect(screen.getByText('Clean sheets')).toBeInTheDocument();
    // The "0" for clean sheets appears alongside "0" for goals/assists; assert
    // there are three zero-value cells rendered (goals, assists, clean sheets).
    expect(screen.getAllByText('0')).toHaveLength(3);
  });
});

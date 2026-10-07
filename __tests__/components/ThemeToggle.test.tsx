import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { ThemeProvider } from '@/context/ThemeContext';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a moon icon and switches to light when currently dark', () => {
    localStorage.setItem('promiscope_theme_preference', 'dark');
    renderToggle();

    const button = screen.getByRole('button', { name: 'Switch to light mode' });
    fireEvent.click(button);
    expect(
      screen.getByRole('button', { name: 'Switch to dark mode' }),
    ).toBeInTheDocument();
  });

  it('renders a sun icon and switches to dark when currently light', () => {
    localStorage.setItem('promiscope_theme_preference', 'light');
    renderToggle();

    const button = screen.getByRole('button', { name: 'Switch to dark mode' });
    fireEvent.click(button);
    expect(
      screen.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeInTheDocument();
  });
});

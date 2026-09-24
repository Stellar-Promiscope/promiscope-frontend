import React from 'react';
import { render, screen } from '@testing-library/react';

// Use the real next-intl (jest.setup.ts stubs it) so the primitives resolve
// their labels from the actual fr messages.
jest.unmock('next-intl');

import { NextIntlClientProvider } from 'next-intl';
import fr from '@/messages/fr.json';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TruncatedAddress from '@/components/ui/TruncatedAddress';

function renderFr(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('UI primitives in fr', () => {
  it('translates the Modal close button', () => {
    renderFr(
      <Modal isOpen onClose={() => {}} title="Titre">
        contenu
      </Modal>,
    );
    expect(
      screen.getByRole('button', { name: 'Fermer la fenêtre' }),
    ).toBeInTheDocument();
  });

  it('translates the Spinner status label', () => {
    renderFr(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Chargement',
    );
  });

  it('translates ConfirmDialog default button labels', () => {
    renderFr(
      <ConfirmDialog
        isOpen
        onConfirm={() => {}}
        onCancel={() => {}}
        title="Titre"
        message="Message"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Confirmer' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('translates the TruncatedAddress copy hint', () => {
    renderFr(<TruncatedAddress address="GABCDEFGHIJKLMNOPQRSTUVWXYZ234567" />);
    expect(
      screen.getByTitle("Cliquer pour copier l'adresse"),
    ).toBeInTheDocument();
  });
});

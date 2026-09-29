import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import Select from './Select';

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    error: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

const Options = () => (
  <>
    <option value="">Select a tier…</option>
    <option value="basic">Basic — 10 XLM / month</option>
    <option value="pro">Pro — 25 XLM / month</option>
    <option value="elite">Elite — 50 XLM / month</option>
  </>
);

export const Default: Story = {
  render: () => (
    <Select>
      <Options />
    </Select>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <Select label="Subscription Tier">
      <Options />
    </Select>
  ),
};

export const WithError: Story = {
  render: () => (
    <Select label="Subscription Tier" error="Please select a tier to continue.">
      <Options />
    </Select>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Select label="Subscription Tier" disabled>
      <Options />
    </Select>
  ),
};

export const WithPreselected: Story = {
  name: 'With Pre-selected Value',
  render: () => (
    <Select label="Subscription Tier" defaultValue="pro">
      <Options />
    </Select>
  ),
};

/**
 * Interaction test (issue #1322): the label is wired to the control, keyboard
 * focus lands on it, and choosing an option updates the value. (Arrow-key and
 * typeahead navigation of a native <select> is handled by the browser itself.)
 */
export const SelectionPlay: Story = {
  name: 'Keyboard focus and selection (play)',
  render: () => (
    <Select label="Subscription Tier">
      <Options />
    </Select>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByLabelText('Subscription Tier');

    await userEvent.tab();
    await expect(select).toHaveFocus();

    await userEvent.selectOptions(select, 'pro');
    await expect(select).toHaveValue('pro');
    await expect(
      canvas.getByRole('option', { name: /Pro/ }) as HTMLOptionElement,
    ).toHaveProperty('selected', true);
  },
};

/** Interaction test: an error is announced and linked to the control. */
export const ErrorWiringPlay: Story = {
  name: 'Error is linked to the control (play)',
  render: WithError.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByLabelText('Subscription Tier');
    await expect(select).toHaveAttribute('aria-invalid', 'true');
    await expect(select).toHaveAccessibleDescription(
      'Please select a tier to continue.',
    );
    await expect(canvas.getByRole('alert')).toBeInTheDocument();
  },
};

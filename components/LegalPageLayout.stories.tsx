import type { Meta, StoryObj } from '@storybook/react';
import LegalPageLayout from './ui/LegalPageLayout';

const meta: Meta<typeof LegalPageLayout> = {
  title: 'UI/LegalPageLayout',
  component: LegalPageLayout,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LegalPageLayout>;

export const ShortContent: Story = {
  args: {
    locale: 'en',
    backToHomeLabel: 'Back to home',
    eyebrow: 'Privacy',
    title: 'Privacy Policy',
    description:
      'Learn how Promiscope collects, uses, and protects information when you use the platform.',
    children: (
      <>
        <h2>Information we collect</h2>
        <p>
          We collect only the information needed to provide scouting tools,
          support account security, and improve the experience.
        </p>
        <p>
          Questions about this policy can be sent to{' '}
          <a href="mailto:privacy@promiscope.example">privacy@promiscope.example</a>.
        </p>
      </>
    ),
  },
};

export const LongContentWithTableOfContents: Story = {
  args: {
    locale: 'en',
    backToHomeLabel: 'Back to home',
    eyebrow: 'Terms',
    title: 'Terms of Service',
    description:
      'The rules and responsibilities that apply when using Promiscope services.',
    lastUpdated: 'Last updated: August 27, 2026',
    children: (
      <>
        <p>
          These terms explain how the service works and provide a shared
          reference for players, scouts, and organizations.
        </p>
        <h2 id="contents">Contents</h2>
        <ul>
          <li>
            <a href="#eligibility">Eligibility</a>
          </li>
          <li>
            <a href="#accounts">Accounts and security</a>
          </li>
          <li>
            <a href="#acceptable-use">Acceptable use</a>
          </li>
          <li>
            <a href="#contact">Contact</a>
          </li>
        </ul>
        <h2 id="eligibility">Eligibility</h2>
        <p>
          You must be legally able to enter into these terms and provide
          accurate information when creating a profile or organization account.
        </p>
        <h2 id="accounts">Accounts and security</h2>
        <p>
          Keep your sign-in details secure and tell us promptly if you notice
          unauthorized activity. You are responsible for activity performed
          through your account.
        </p>
        <h2 id="acceptable-use">Acceptable use</h2>
        <p>
          Use the platform lawfully and respectfully. Do not misrepresent your
          identity, misuse another person&apos;s information, or interfere with
          the service.
        </p>
        <h2 id="contact">Contact</h2>
        <p>
          For questions about these terms, contact{' '}
          <a href="mailto:legal@promiscope.example">legal@promiscope.example</a>.
        </p>
      </>
    ),
  },
};

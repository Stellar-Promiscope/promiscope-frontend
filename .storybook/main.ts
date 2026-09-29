import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  docs: { autodocs: 'tag' },
  async viteFinal(config) {
    config.plugins ??= [];
    config.plugins.push(react(), tsconfigPaths());
    // Unlike Next.js's webpack build, Vite doesn't polyfill Node's `process`
    // global — code under lib/ (e.g. lib/stellar.ts) reads process.env.* at
    // module scope, which throws "process is not defined" the moment
    // Storybook imports it and crashes every story that pulls it in
    // transitively (PlayerCard → lib/contract.ts → lib/stellar.ts). Defining
    // process.env as an empty object lets those reads resolve to `undefined`
    // and fall through to their `??`/`||` defaults instead of throwing.
    config.define = {
      ...config.define,
      'process.env': {},
    };
    // Storybook uses the plain react-vite framework rather than
    // @storybook/nextjs, so there's no App Router context provider for
    // `next/navigation`'s hooks — components calling useRouter() (e.g.
    // PlayerCard) throw and crash the story instead of rendering. Alias to
    // a no-op stub so those hooks resolve harmlessly. See .storybook/mocks/next-navigation.tsx.
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      'next/navigation': path.resolve(dirname, './mocks/next-navigation.tsx'),
    };
    return config;
  },
};

export default config;

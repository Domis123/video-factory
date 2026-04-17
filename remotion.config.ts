import { Config } from '@remotion/cli/config';

Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...(config.resolve ?? {}),
    extensionAlias: {
      ...((config.resolve as { extensionAlias?: Record<string, string[]> })?.extensionAlias ?? {}),
      '.js': ['.tsx', '.ts', '.js'],
      '.mjs': ['.mts', '.mjs'],
    },
  },
}));

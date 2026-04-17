import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { HookDemoCTA } from './layouts/HookDemoCTA.js';
import { HookListicleCTA } from './layouts/HookListicleCTA.js';
import { HookTransformation } from './layouts/HookTransformation.js';
import { Phase3Parameterized } from './layouts/Phase3Parameterized.js';

/** Default props for Remotion Studio preview (Phase 2) */
const defaultProps = {
  contextPacket: null,
  clipPaths: {},
  transcriptions: {},
  logoPath: null,
  musicPath: null,
  beatMap: null,
};

/** Default props for Phase 3 composition preview */
const defaultPhase3Props = {
  brief: null,
  copyPackage: null,
  clipPaths: {},
  transcriptions: {},
  logoPath: null,
  musicPath: null,
  brandConfig: null,
  beatMap: null,
};

/**
 * Template registry — maps template_id to Remotion Composition.
 * The renderer looks up the correct composition by template_id from the Context Packet.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="hook-demo-cta"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={HookDemoCTA as React.FC<any>}
        durationInFrames={30 * 45}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="hook-listicle-cta"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={HookListicleCTA as React.FC<any>}
        durationInFrames={30 * 45}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="hook-transformation"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={HookTransformation as React.FC<any>}
        durationInFrames={30 * 45}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="phase3-parameterized-v1"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={Phase3Parameterized as React.FC<any>}
        durationInFrames={30 * 45}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultPhase3Props}
      />
    </>
  );
};

// Remotion entry-point side effect: the bundler looks for this call in the
// file passed to `bundle({ entryPoint })`. Without it the bundler throws
// `this file does not contain "registerRoot"`.
registerRoot(RemotionRoot);

// @azure/communication-calling-effects ships its types at types/…d.ts but has no `exports` map, so
// under moduleResolution "bundler" TypeScript follows `module` to an untyped .js and gives up.
// The *calling* package already declares the shapes these classes implement, so declare the two
// constructors we use in terms of those rather than restating them.
declare module '@azure/communication-calling-effects' {
	import type {
		BackgroundBlurEffect as BlurShape,
		BackgroundReplacementConfig,
		BackgroundReplacementEffect as ReplaceShape
	} from '@azure/communication-calling';

	export const BackgroundBlurEffect: new () => BlurShape;
	export const BackgroundReplacementEffect: new (config: BackgroundReplacementConfig) => ReplaceShape;
}

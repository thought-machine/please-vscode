import { Language } from './constants';
import * as go from './go/debug';
import * as python from './python/debug';

export const languageTargetDebuggers: Partial<
  Record<Language, (target: string, runtimeArgs: string[]) => Promise<boolean>>
> = {
  go: go.debug,
  python: python.debug,
};

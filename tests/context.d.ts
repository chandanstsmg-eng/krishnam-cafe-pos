import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    testDbUrl: string;
  }
}


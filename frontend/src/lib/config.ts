/**
 * Mocks are a development tool. `import.meta.env.PROD` is statically true in `vite build`, so this
 * constant folds to `false` there: MSW is never started and its dynamic import is dropped from the
 * bundle, whatever VITE_USE_MOCKS says. vite.config.ts also refuses VITE_USE_MOCKS=true for a build.
 */
export const USE_MOCKS = !import.meta.env.PROD && import.meta.env.VITE_USE_MOCKS === 'true';

export const config = {
  /**
   * Absolute in production (e.g. https://bookleaf-api.onrender.com/api/v1). The relative default only
   * works behind the Vite dev proxy, and vite.config.ts requires VITE_API_URL for builds.
   */
  apiUrl: (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, ''),
  useMocks: USE_MOCKS,
  mockAiDown: import.meta.env.VITE_MOCK_AI_DOWN === 'true',
} as const;

export const config = {
  apiUrl: (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, ''),
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  mockAiDown: import.meta.env.VITE_MOCK_AI_DOWN === 'true',
} as const;

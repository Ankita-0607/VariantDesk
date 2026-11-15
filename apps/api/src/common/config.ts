/** Central, typed access to environment configuration. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET ?? '',
  ai: {
    provider: (process.env.AI_PROVIDER ?? 'none') as 'anthropic' | 'openai_compatible' | 'none',
    model: process.env.AI_MODEL ?? 'claude-opus-5-5',
    openaiBaseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'http://localhost:11434/v1',
    openaiModel: process.env.OPENAI_COMPATIBLE_MODEL ?? 'llama3.1',
    openaiApiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
  },
  kb: {
    ncbiApiKey: process.env.NCBI_API_KEY ?? '',
    cacheTtlHours: Number(process.env.KB_CACHE_TTL_HOURS ?? 168),
    offline: process.env.KB_OFFLINE === '1',
    maxVariants: Number(process.env.MAX_VARIANTS_PER_CASE ?? 2000),
  },
};

export function assertConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be set to a random string of at least 16 characters.');
  }
}

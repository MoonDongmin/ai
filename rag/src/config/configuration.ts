export default () => ({
  database: {
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT ?? "5432"),
    username: process.env.POSTGRES_USER,
    password:process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  },
  ollama: {
    baseUrl: process.env.OLLAMA_URL,
    model: process.env.OLLAMA_MODEL,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  },
})

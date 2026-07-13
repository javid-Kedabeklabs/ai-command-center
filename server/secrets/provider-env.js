const SAFE_PROCESS_KEYS = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'SHELL', 'SYSTEMROOT', 'WINDIR']

export function minimalProviderEnvironment(source = process.env, credentials = {}) {
  const env = {}
  for (const key of SAFE_PROCESS_KEYS) if (typeof source[key] === 'string' && source[key]) env[key] = source[key]
  if (credentials.openai) env.OPENAI_API_KEY = String(credentials.openai)
  if (credentials.anthropic) env.ANTHROPIC_API_KEY = String(credentials.anthropic)
  return env
}

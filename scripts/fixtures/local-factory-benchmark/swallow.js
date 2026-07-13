export async function loadConfiguration(provider) {
  try {
    return await provider.load()
  } catch {
    return null
  }
}

'use server'

export async function authenticate(username: unknown, password: unknown): Promise<boolean> {
  const configuredUsername = process.env.K6_STUDIO_USERNAME
  const configuredPassword = process.env.K6_STUDIO_PASSWORD

  if (
    configuredUsername === undefined ||
    configuredPassword === undefined ||
    typeof username !== 'string' ||
    typeof password !== 'string'
  ) {
    return false
  }

  return username === configuredUsername && password === configuredPassword
}

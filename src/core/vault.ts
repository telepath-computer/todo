export type Vault = {
  dir: string
}

export function loadVault(dir: string): Vault {
  return { dir }
}

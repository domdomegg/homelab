export interface Env {
  STAGE: 'local' | 'prod',

  /** @example home.adamjones.me */
  BASE_DOMAIN: string,

  /** @example pk1_abcdef */
  PORKBUN_API_KEY: string,
  /** @example sk1_abcdef */
  PORKBUN_SECRET_API_KEY: string,
}

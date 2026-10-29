/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" adds the "Explore with demo data" guest mode (frontend-only builds such as GitHub Pages). */
  readonly VITE_GUEST_MODE?: string;
}

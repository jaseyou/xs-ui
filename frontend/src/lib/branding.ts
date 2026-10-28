// Central branding configuration. Everything user-facing (panel name, colors,
// external links, PWA manifest) reads from here — change these values and the
// whole panel rebrands. Leave a URL empty ('') to hide that button or badge.

/** Full panel name shown in the sidebar, login page, page titles and 2FA issuer. */
export const BRAND_NAME = 'MyPanel';

/** Short mark shown in the collapsed sidebar rail. */
export const BRAND_SHORT_NAME = 'MP';

/** Primary brand color, used for buttons, links and accents in both themes. */
export const BRAND_COLOR = '#722ed1';
export const BRAND_COLOR_HOVER = '#9254de';
export const BRAND_COLOR_ACTIVE = '#531dab';

/** PWA/browser theme color (manifest `theme_color`). */
export const BRAND_THEME_COLOR = BRAND_COLOR;

/** GitHub repository shown next to the version badge; empty hides the badge link. */
export const BRAND_REPO_URL = '';

/** Documentation link in the sidebar; empty hides the docs button. */
export const BRAND_DOCS_URL = '';

/** Donation link in the sidebar; empty hides the donate button. */
export const BRAND_DONATE_URL = '';

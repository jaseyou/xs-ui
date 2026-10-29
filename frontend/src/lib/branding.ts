// Central branding configuration. Everything user-facing (panel name, colors,
// external links, PWA manifest) reads from here — change these values and the
// whole panel rebrands. Leave a URL empty ('') to hide that button or badge.

/** Full panel name shown in the sidebar, login page, page titles and 2FA issuer. */
export const BRAND_NAME = 'xs-ui';

/** Short mark shown in the collapsed sidebar rail. */
export const BRAND_SHORT_NAME = 'xs';

/**
 * Primary brand color — a warm terracotta in the vein of Claude's desktop
 * apps: ivory surfaces, warm grays and a single orange accent.
 */
export const BRAND_COLOR = '#d97757';
export const BRAND_COLOR_HOVER = '#e08d6f';
export const BRAND_COLOR_ACTIVE = '#c4633f';

/** PWA/browser theme color (manifest `theme_color`). */
export const BRAND_THEME_COLOR = BRAND_COLOR;

/** GitHub repository shown next to the version badge; empty hides the badge link. */
export const BRAND_REPO_URL = '';

/** Documentation link in the sidebar; empty hides the docs button. */
export const BRAND_DOCS_URL = '';

/** Donation link in the sidebar; empty hides the donate button. */
export const BRAND_DONATE_URL = '';

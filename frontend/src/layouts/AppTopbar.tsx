import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { Dropdown, Drawer, Menu, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApartmentOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DiscordOutlined,
  LogoutOutlined,
  MailOutlined,
  MenuOutlined,
  MoonFilled,
  MoonOutlined,
  SafetyOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  TelegramFilled,
} from '@ant-design/icons';

import { HttpUtil } from '@/utils';
import { pauseAnimationsUntilLeave } from '@/hooks/useTheme';
import { useTheme } from '@/hooks/useTheme';
import { useCommandPalette } from '@/components/command-palette/useCommandPalette';
import { useAllSettings } from '@/api/queries/useAllSettings';
import { SIMPLE_MODE_HIDDEN_ROUTES, useSimpleMode } from '@/hooks/useSimpleMode';
import { PANEL_ROUTES } from '@/routes/panelRoutes';
import { BRAND_NAME, BRAND_REPO_URL } from '@/lib/branding';
import { formatPanelVersion } from '@/lib/panel-version';
import './AppTopbar.css';

const LOGOUT_KEY = '__logout__';
// The palette listens for Ctrl as well as Cmd, so the chip must not show a
// Mac glyph to the Linux and Windows operators who are most of this panel's.
const SHORTCUT_MODIFIER = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
// Narrow viewports switch the inline nav to a drawer; keep in sync with the CSS.
const MOBILE_QUERY = '(max-width: 1100px)';

function useIsMobileNav() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

function ThemeCycleButton({
  isDark,
  isUltra,
  onCycle,
}: {
  isDark: boolean;
  isUltra: boolean;
  onCycle: () => void;
}) {
  const { t } = useTranslation();
  const icon = !isDark ? (
    <SunOutlined aria-hidden />
  ) : !isUltra ? (
    <MoonOutlined aria-hidden />
  ) : (
    <MoonFilled aria-hidden />
  );
  const ariaLabel = t('menu.theme');
  return (
    <button
      type="button"
      className="topbar-icon-btn"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onCycle}
    >
      {icon}
    </button>
  );
}

function VersionBadge({ version }: { version: string }) {
  if (!version) return null;
  const label = formatPanelVersion(version);
  if (!BRAND_REPO_URL) {
    return (
      <span className="topbar-version" title={label}>
        {label}
      </span>
    );
  }
  return (
    <a
      href={BRAND_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="topbar-version"
      title={label}
    >
      {label}
    </a>
  );
}

export default function AppTopbar() {
  const { t } = useTranslation();
  const { isDark, isUltra, toggleTheme, toggleUltra } = useTheme();
  const { open: openCommandPalette } = useCommandPalette();
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const { allSetting } = useAllSettings();
  const { simple, toggle: toggleSimple } = useSimpleMode();
  const showSubFormats = !!(allSetting.subJsonEnable || allSetting.subClashEnable);
  const showSubBalancers = !!allSetting.subJsonEnable;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobileNav = useIsMobileNav();

  const panelVersion = window.X_UI_CUR_VER || '';

  const settingsChildren = useMemo<NonNullable<MenuProps['items']>>(() => {
    const children: NonNullable<MenuProps['items']> = [
      {
        key: '/settings#general',
        icon: <SettingOutlined aria-hidden />,
        label: t('pages.settings.panelSettings'),
      },
      {
        key: '/settings#security',
        icon: <SafetyOutlined aria-hidden />,
        label: t('pages.settings.securitySettings'),
      },
      {
        key: '/settings#telegram',
        icon: <TelegramFilled aria-hidden />,
        label: t('pages.settings.TGBotSettings'),
      },
      {
        key: '/settings#email',
        icon: <MailOutlined aria-hidden />,
        label: t('pages.settings.emailSettings'),
      },
      {
        key: '/settings#discord',
        icon: <DiscordOutlined aria-hidden />,
        label: t('pages.settings.discordSettings'),
      },
      {
        key: '/settings#subscription',
        icon: <CloudServerOutlined aria-hidden />,
        label: t('pages.settings.subSettings'),
      },
    ];
    if (showSubFormats) {
      children.push({
        key: '/settings#subscription-formats',
        icon: <CodeOutlined aria-hidden />,
        label: t('menu.subFormats'),
      });
    }
    if (showSubBalancers) {
      children.push({
        key: '/settings#subscription-balancers',
        icon: <ApartmentOutlined aria-hidden />,
        label: t('pages.settings.subBalancers.menu'),
      });
    }
    return children;
  }, [t, showSubFormats, showSubBalancers]);

  const xrayChildren = useMemo<NonNullable<MenuProps['items']>>(
    () => [
      {
        key: '/xray#basic',
        icon: <SettingOutlined aria-hidden />,
        label: t('pages.xray.basicTemplate'),
      },
      {
        key: '/xray#balancer',
        icon: <ClusterOutlined aria-hidden />,
        label: t('pages.xray.Balancers'),
      },
      { key: '/xray#dns', icon: <DatabaseOutlined aria-hidden />, label: 'DNS' },
      {
        key: '/xray#advanced',
        icon: <CodeOutlined aria-hidden />,
        label: t('pages.xray.advancedTemplate'),
      },
    ],
    [t],
  );

  const openLink = useCallback(
    async (key: string) => {
      if (key === LOGOUT_KEY) {
        await HttpUtil.post('/logout');
        window.location.href = window.X_UI_BASE_PATH || '/';
        return;
      }
      navigate(key);
    },
    [navigate],
  );

  const onMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    ({ key }) => {
      setDrawerOpen(false);
      void openLink(String(key));
    },
    [openLink],
  );

  const cycleTheme = useCallback(() => {
    pauseAnimationsUntilLeave('topbar-theme-cycle');
    if (!isDark) {
      toggleTheme();
      if (isUltra) toggleUltra();
    } else if (!isUltra) {
      toggleUltra();
    } else {
      toggleUltra();
      toggleTheme();
    }
  }, [isDark, isUltra, toggleTheme, toggleUltra]);

  const visibleRoutes = useMemo(
    () =>
      simple
        ? PANEL_ROUTES.filter((route) => !SIMPLE_MODE_HIDDEN_ROUTES.has(route.path))
        : PANEL_ROUTES,
    [simple],
  );

  const drawerItems = useMemo<MenuProps['items']>(() => {
    const items: MenuProps['items'] = visibleRoutes.map((route) => {
      const Icon = route.icon as ComponentType;
      if (route.path === '/settings')
        return {
          key: route.path,
          icon: <Icon aria-hidden />,
          label: t(route.titleKey),
          children: settingsChildren,
        };
      if (route.path === '/xray')
        return {
          key: route.path,
          icon: <Icon aria-hidden />,
          label: t(route.titleKey),
          children: xrayChildren,
        };
      return { key: route.path, icon: <Icon aria-hidden />, label: t(route.titleKey) };
    });
    items.push({ type: 'divider' });
    items.push({ key: LOGOUT_KEY, icon: <LogoutOutlined aria-hidden />, label: t('logout') });
    return items;
  }, [visibleRoutes, settingsChildren, xrayChildren, t]);

  const settingsActive = pathname === '/settings';
  const xrayActive = pathname === '/xray';

  const desktopItems = useMemo(
    () =>
      visibleRoutes.map((route) => {
        const Icon = route.icon;
        const label = t(route.titleKey);
        const active = route.path === '/' ? pathname === '/' : pathname.startsWith(route.path);
        if (route.path === '/settings') {
          return (
            <Dropdown
              key={route.path}
              menu={{ items: settingsChildren, onClick: onMenuClick }}
              trigger={['click']}
            >
              <button
                type="button"
                className={`topbar-nav-btn${settingsActive ? ' active' : ''}`}
                aria-expanded={false}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </button>
            </Dropdown>
          );
        }
        if (route.path === '/xray') {
          return (
            <Dropdown
              key={route.path}
              menu={{ items: xrayChildren, onClick: onMenuClick }}
              trigger={['click']}
            >
              <button
                type="button"
                className={`topbar-nav-btn${xrayActive ? ' active' : ''}`}
                aria-expanded={false}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </button>
            </Dropdown>
          );
        }
        return (
          <button
            key={route.path}
            type="button"
            className={`topbar-nav-btn${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => void openLink(route.path)}
          >
            <Icon aria-hidden />
            <span>{label}</span>
          </button>
        );
      }),
    [
      visibleRoutes,
      openLink,
      onMenuClick,
      pathname,
      settingsActive,
      settingsChildren,
      t,
      xrayActive,
      xrayChildren,
    ],
  );

  const drawerSelectedKey = settingsActive
    ? `/settings${hash || '#general'}`
    : xrayActive
      ? `/xray${hash || '#basic'}`
      : pathname;
  const drawerOpenKeys = settingsActive ? ['/settings'] : xrayActive ? ['/xray'] : [];

  const commandTrigger = (
    <Tooltip title={`${t('commandPalette.title') || 'Command Palette'} (${SHORTCUT_MODIFIER} + K)`}>
      <button
        type="button"
        className="topbar-search"
        onClick={openCommandPalette}
        aria-label={t('commandPalette.title') || 'Command Palette (Ctrl + K)'}
      >
        <SearchOutlined aria-hidden />
        <span className="topbar-search-text">{t('commandPalette.search') || 'Search...'}</span>
        <span className="topbar-search-kbd">
          <span>{SHORTCUT_MODIFIER}</span>
          <span>K</span>
        </span>
      </button>
    </Tooltip>
  );

  return (
    <header className="ant-topbar" style={{ '--topbar-height': '56px' } as CSSProperties}>
      <div className="topbar-brand">
        <span className="topbar-logo" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M6 5l6 7-6 7" />
            <path d="M18 5l-6 7 6 7" />
          </svg>
        </span>
        <span className="topbar-brand-text">{BRAND_NAME}</span>
      </div>

      {!isMobileNav && (
        <nav className="topbar-nav" aria-label={t('menu.dashboard') ? 'Main' : 'Main'}>
          {desktopItems}
        </nav>
      )}

      <div className="topbar-actions">
        <Tooltip title={t('simpleMode.toggleTitle')}>
          <button
            type="button"
            className={`topbar-mode-btn${simple ? ' simple' : ''}`}
            aria-pressed={!simple}
            onClick={toggleSimple}
          >
            {simple ? t('simpleMode.toExpert') : t('simpleMode.toSimple')}
          </button>
        </Tooltip>
        {commandTrigger}
        <VersionBadge version={panelVersion} />
        <ThemeCycleButton isDark={isDark} isUltra={isUltra} onCycle={cycleTheme} />
        {isMobileNav && (
          <button
            type="button"
            className="topbar-icon-btn"
            aria-label={t('menu.dashboard') ? 'Menu' : 'Menu'}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuOutlined aria-hidden />
          </button>
        )}
        {!isMobileNav && (
          <Tooltip title={t('logout')}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label={t('logout')}
              onClick={() => void openLink(LOGOUT_KEY)}
            >
              <LogoutOutlined aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>

      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={BRAND_NAME}
        width={260}
        styles={{ body: { padding: 0 } }}
      >
        <Menu
          mode="inline"
          items={drawerItems}
          selectedKeys={[drawerSelectedKey]}
          defaultOpenKeys={drawerOpenKeys}
          onClick={onMenuClick}
        />
      </Drawer>
    </header>
  );
}

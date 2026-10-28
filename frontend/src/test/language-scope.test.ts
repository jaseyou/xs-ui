import { afterEach, describe, expect, it, vi } from 'vitest';

describe('subscription language scope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes lazily and changes the subscription language without changing the panel', async () => {
    vi.resetModules();
    const utils = await import('@/utils');
    const cookies = new Map<string, string>([['lang', 'en-US']]);
    vi.spyOn(utils.CookieManager, 'getCookie').mockImplementation(
      (name) => cookies.get(name) ?? '',
    );
    vi.spyOn(utils.CookieManager, 'setCookie').mockImplementation((name, value) => {
      cookies.set(name, value);
    });
    const getLanguage = vi.spyOn(utils.LanguageManager, 'getLanguage');
    const reload = vi.fn();
    vi.stubGlobal('window', { navigator: { language: 'en-US' }, location: { reload } });
    vi.stubGlobal('document', { documentElement: {} });

    const { readyI18n } = await import('@/i18n/react');
    expect(getLanguage).not.toHaveBeenCalled();

    await readyI18n('subscription');
    expect(cookies.get('subLang')).toBe('en-US');

    utils.LanguageManager.setLanguage('zh-CN', 'subscription');
    expect(cookies.get('lang')).toBe('en-US');
    expect(cookies.get('subLang')).toBe('zh-CN');
    expect(reload).toHaveBeenCalledOnce();

    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locale?: Intl.LocalesArgument,
    ) {
      return { format: () => String(locale) } as Intl.DateTimeFormat;
    } as typeof Intl.DateTimeFormat);
    expect(utils.IntlUtil.formatDate(0, 'gregorian', 'zh-CN')).toBe('zh-CN');
    expect(dateTimeFormat).toHaveBeenLastCalledWith('zh-CN', expect.any(Object));
  });

  it('maps a Chinese browser to the Chinese panel locale', async () => {
    vi.resetModules();
    const utils = await import('@/utils');
    const cookies = new Map<string, string>();
    vi.spyOn(utils.CookieManager, 'getCookie').mockImplementation(
      (name) => cookies.get(name) ?? '',
    );
    vi.spyOn(utils.CookieManager, 'setCookie').mockImplementation((name, value) => {
      cookies.set(name, value);
    });
    const reload = vi.fn();
    vi.stubGlobal('window', { navigator: { language: 'zh' }, location: { reload } });

    expect(utils.LanguageManager.getLanguage()).toBe('zh-CN');
    expect(cookies.get('lang')).toBe('zh-CN');
    expect(reload).not.toHaveBeenCalled();
  });

  it('falls back to English for languages the panel no longer ships', async () => {
    vi.resetModules();
    const utils = await import('@/utils');
    const cookies = new Map<string, string>();
    vi.spyOn(utils.CookieManager, 'getCookie').mockImplementation(
      (name) => cookies.get(name) ?? '',
    );
    vi.spyOn(utils.CookieManager, 'setCookie').mockImplementation((name, value) => {
      cookies.set(name, value);
    });
    const reload = vi.fn();
    vi.stubGlobal('window', { navigator: { language: 'sk' }, location: { reload } });

    utils.LanguageManager.getLanguage();
    expect(cookies.get('lang')).toBe('en-US');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not resolve the language for empty or invalid dates', async () => {
    const utils = await import('@/utils');
    const getLanguage = vi.spyOn(utils.LanguageManager, 'getLanguage').mockReturnValue('en-US');

    expect(utils.IntlUtil.formatDate(null)).toBe('');
    expect(utils.IntlUtil.formatDate(undefined)).toBe('');
    expect(utils.IntlUtil.formatDate('not-a-date')).toBe('');
    expect(getLanguage).not.toHaveBeenCalled();
  });
});

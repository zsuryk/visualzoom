import { test, expect } from '@playwright/test';
import {
  MODIFIERS,
  POLICIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  siteSettings,
  hostnameFor,
} from '../src/settings/store.js';

test.describe('06 — settings core', () => {
  test('@unit defaults: alt modifier, per-site memory off, crisp-text never on', () => {
    const s = sanitizeSettings(undefined);
    expect(s.zoomModifier).toBe('altKey');
    expect(s.hotkeys).toEqual({
      zoomIn: { modifier: 'altKey', key: '+' },
      zoomOut: { modifier: 'altKey', key: '-' },
      reset: { modifier: 'altKey', key: '0' },
    });
    expect(s.memoryDefault).toBe(false);
    expect(s.fixedElementPolicy).toBe('scale-everything');
    expect(s.sites).toEqual({});
    expect(DEFAULT_SETTINGS.memoryDefault).toBe(false);
  });

  test('@unit invalid fields fall back to defaults, unknown fields are dropped', () => {
    const s = sanitizeSettings({
      zoomModifier: 'capsLock',
      hotkeys: { zoomIn: { modifier: 3, key: '' }, zoomOut: 'junk', reset: { modifier: 'ctrlKey', key: '0' } },
      memoryDefault: 'yes',
      fixedElementPolicy: 'reflow-everything',
      bogus: 42,
      sites: 'nope',
    });
    expect(s.zoomModifier).toBe('altKey');
    expect(s.hotkeys.zoomIn).toEqual({ modifier: 'altKey', key: '+' });
    expect(s.hotkeys.zoomOut).toEqual({ modifier: 'altKey', key: '-' });
    expect(s.hotkeys.reset).toEqual({ modifier: 'ctrlKey', key: '0' });
    expect(s.memoryDefault).toBe(false);
    expect(s.fixedElementPolicy).toBe('scale-everything');
    expect(s.sites).toEqual({});
  });

  test('@unit every modifier and policy value is accepted round-trip', () => {
    for (const modifier of MODIFIERS) {
      const s = sanitizeSettings({ zoomModifier: modifier });
      expect(s.zoomModifier).toBe(modifier);
    }
    for (const policy of POLICIES) {
      const s = sanitizeSettings({ fixedElementPolicy: policy });
      expect(s.fixedElementPolicy).toBe(policy);
    }
  });

  test('@unit per-site overrides are sanitized and empties are dropped', () => {
    const s = sanitizeSettings({
      sites: {
        'example.com': { enabled: false, memory: true, crispText: true, scale: 1.5 },
        'stripped.example.com': {},
        'weird.example.com': { enabled: 'no', scale: 'big', crispText: false },
      },
    });
    expect(s.sites['example.com']).toEqual({
      enabled: false,
      memory: true,
      crispText: true,
      scale: 1.5,
    });
    expect(s.sites['stripped.example.com']).toBeUndefined();
    expect(s.sites['weird.example.com']).toBeUndefined();
  });

  test('@unit siteSettings resolves global defaults unless a per-site override exists', () => {
    const settings = sanitizeSettings({
      memoryDefault: true,
      sites: {
        'example.com': { memory: false, crispText: true, scale: 2 },
        'disabled.example.com': { enabled: false },
      },
    });
    // example.com: per-site memory override, crisp on, remembered scale.
    expect(siteSettings(settings, 'example.com')).toEqual({
      enabled: true,
      memory: false,
      crispText: true,
      scale: 2,
      fixedElementPolicy: 'scale-everything',
    });
    // No override for this host: memory inherits the global default.
    expect(siteSettings(settings, 'plain.example.com')).toEqual({
      enabled: true,
      memory: true,
      crispText: false,
      scale: 1,
      fixedElementPolicy: 'scale-everything',
    });
    expect(siteSettings(settings, 'disabled.example.com').enabled).toBe(false);
  });

  test('@unit crisp-text is never on by default, even for a fresh site', () => {
    const settings = sanitizeSettings({ memoryDefault: true });
    expect(siteSettings(settings, 'any.example.com').crispText).toBe(false);
  });

  test('@unit fixed-element policy can be overridden per site', () => {
    const settings = sanitizeSettings({
      fixedElementPolicy: 'protect-modals',
      sites: { 'example.com': { fixedElementPolicy: 'protect-sticky-too' } },
    });
    expect(siteSettings(settings, 'example.com').fixedElementPolicy).toBe('protect-sticky-too');
    expect(siteSettings(settings, 'other.example.com').fixedElementPolicy).toBe('protect-modals');
  });

  test('@unit hostnameFor strips www, lowercases, and ignores path/port', () => {
    expect(hostnameFor('https://Example.COM/path?q=1')).toBe('example.com');
    expect(hostnameFor('https://www.Example.com/')).toBe('example.com');
    expect(hostnameFor('http://127.0.0.1:4173/fixtures/x.html')).toBe('127.0.0.1');
    expect(hostnameFor('https://api.stripe.com/v1')).toBe('api.stripe.com');
    expect(hostnameFor('not a url')).toBe('');
  });
});
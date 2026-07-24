/**
 * Auto-generated controls panel: renders a layer's config Schema into DOM
 * controls. Adding a new layer/preset requires zero code here — sliders,
 * colors, toggles, selects, text and image pickers all come from the schema.
 */

import type { FieldSpec, ImageRef, LayerConfig, Schema } from '../engine/layers/api';
import type { ThemeColors } from '../engine/types';
import { THEMES, getTheme } from '../themes';
import { fieldLabel, t } from '../i18n';
import { el, pickFile } from './dom';

export interface ControlsHost {
  getTheme(): ThemeColors;
  /** Id of the project's active palette. */
  getThemeId(): string;
  /** Called after any config mutation (re-render preview, refresh thumbs). */
  onChange(): void;
}

export function buildControls(schema: Schema, config: LayerConfig, host: ControlsHost, idPrefix: string): HTMLElement {
  const root = el('div', { className: 'controls' });
  for (const [key, spec] of Object.entries(schema)) {
    root.append(buildField(key, spec, config, host, `${idPrefix}-${key}`));
  }
  return root;
}

function buildField(key: string, spec: FieldSpec, config: LayerConfig, host: ControlsHost, id: string): HTMLElement {
  const label = fieldLabel(key);
  switch (spec.kind) {
    case 'slider': {
      const value = el('output', { className: 'field-value', for: id }, fmt(config[key] as number, spec.unit));
      const input = el('input', {
        id,
        type: 'range',
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: String(config[key]),
        oninput: () => {
          config[key] = Number(input.value);
          value.textContent = fmt(config[key] as number, spec.unit);
          host.onChange();
        },
      });
      return el('div', { className: 'field field-slider' },
        el('label', { for: id }, label),
        el('div', { className: 'field-slider-row' }, input, value),
      );
    }
    case 'toggle': {
      const input = el('input', {
        id,
        type: 'checkbox',
        checked: config[key] === true,
        onchange: () => {
          config[key] = input.checked;
          host.onChange();
        },
      });
      if (config[key] === true) input.checked = true;
      return el('div', { className: 'field field-toggle' },
        el('label', { for: id }, label),
        el('span', { className: 'switch' }, input, el('span', { className: 'switch-track', 'aria-hidden': 'true' })),
      );
    }
    case 'select': {
      const select = el('select', {
        id,
        onchange: () => {
          config[key] = select.value;
          host.onChange();
        },
      });
      for (const opt of spec.options) {
        select.append(el('option', { value: opt, selected: config[key] === opt }, t(`opt.${opt}`)));
      }
      return el('div', { className: 'field' }, el('label', { for: id }, label), select);
    }
    case 'text': {
      const input = el('input', {
        id,
        type: 'text',
        value: String(config[key] ?? ''),
        oninput: () => {
          config[key] = input.value;
          host.onChange();
        },
      });
      return el('div', { className: 'field field-text' }, el('label', { for: id }, label), input);
    }
    case 'color':
      return buildColorField(key, config, host, id, label);
    case 'image':
      return buildImageField(key, config, host, id, label);
  }
}

/**
 * Color field: swatches from a *source palette* + free custom color.
 * The source defaults to the project's active palette (picks stay linked as
 * `theme:x` and follow theme switches); choosing another palette from the
 * dropdown stores concrete hex values — mix and match across themes.
 */
function buildColorField(key: string, config: LayerConfig, host: ControlsHost, id: string, label: string): HTMLElement {
  let sourceId = host.getThemeId();

  const custom = el('input', {
    id,
    type: 'color',
    value: typeof config[key] === 'string' && !(config[key] as string).startsWith('theme:') ? (config[key] as string) : '#ffffff',
    'aria-label': `${label} — custom`,
    oninput: () => {
      config[key] = custom.value;
      sync();
      host.onChange();
    },
  });

  const paletteSelect = el('select', {
    className: 'palette-select',
    'aria-label': `${label} — ${t('panel.theme')}`,
    onchange: () => {
      sourceId = paletteSelect.value;
      renderSwatches();
    },
  });
  for (const theme of THEMES) {
    paletteSelect.append(el('option', { value: theme.id, selected: theme.id === sourceId }, t(`theme.${theme.id}`)));
  }

  const swatchWrap = el('span', { className: 'swatch-wrap' });
  const row = el('div', { className: 'color-row', role: 'group', 'aria-label': label }, paletteSelect, swatchWrap, custom);

  const slotEntries = (): ReadonlyArray<readonly [slot: string, color: string]> => {
    const colors = getTheme(sourceId).colors;
    return [
      ['theme:a', colors.a],
      ['theme:b', colors.b],
      ['theme:c', colors.c],
      ['theme:bg', colors.bg],
    ] as const;
  };

  const renderSwatches = () => {
    swatchWrap.replaceChildren();
    const linked = sourceId === host.getThemeId();
    for (const [slot, color] of slotEntries()) {
      swatchWrap.append(el('button', {
        type: 'button',
        className: 'swatch',
        style: `--swatch:${color}`,
        'aria-label': `${label}: ${t(`theme.${sourceId}`)} ${slot.slice(6).toUpperCase()}`,
        // Active-palette picks stay linked; foreign-palette picks pin the hex.
        onclick: () => {
          config[key] = linked ? slot : color;
          sync();
          host.onChange();
        },
        'data-value': linked ? slot : color,
      }));
    }
    sync();
  };

  const sync = () => {
    const value = config[key];
    for (const s of swatchWrap.querySelectorAll<HTMLElement>('.swatch')) {
      s.classList.toggle('active', value === s.dataset.value);
    }
    const isCustomHex = typeof value === 'string' && !value.startsWith('theme:')
      && !slotEntries().some(([, color]) => color === value);
    custom.classList.toggle('active', isCustomHex);
  };

  renderSwatches();
  return el('div', { className: 'field field-color' }, el('label', { for: id }, label), row);
}

function buildImageField(key: string, config: LayerConfig, host: ControlsHost, id: string, label: string): HTMLElement {
  const name = el('span', { className: 'image-name' }, (config[key] as ImageRef | null)?.fileName ?? '');
  const clearBtn = el('button', {
    type: 'button',
    className: 'btn btn-ghost btn-small',
    onclick: () => {
      const ref = config[key] as ImageRef | null;
      ref?.bitmap.close();
      config[key] = null;
      name.textContent = '';
      clearBtn.hidden = true;
      host.onChange();
    },
  }, t('img.clear'));
  clearBtn.hidden = !(config[key] as ImageRef | null);

  const chooseBtn = el('button', {
    id,
    type: 'button',
    className: 'btn btn-ghost btn-small',
    onclick: async () => {
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        (config[key] as ImageRef | null)?.bitmap.close();
        config[key] = { bitmap, fileName: file.name } satisfies ImageRef;
        name.textContent = file.name;
        clearBtn.hidden = false;
        host.onChange();
      } catch {
        name.textContent = t('drop.invalid');
      }
    },
  }, t('img.choose'));

  return el('div', { className: 'field field-image' },
    el('label', { for: id }, label),
    el('div', { className: 'image-row' }, chooseBtn, name, clearBtn),
  );
}

function fmt(v: number, unit?: string): string {
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return unit ? `${s}${unit}` : s.replace(/\.?0+$/, '') || '0';
}

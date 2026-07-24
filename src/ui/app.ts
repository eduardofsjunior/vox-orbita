/**
 * Vox Orbita studio: wires the deterministic engine to the DOM.
 * One App instance owns project state, playback, the preview compositor,
 * the auto-generated controls panel and the export flow.
 */

import { decodeAudioFile, fromChannels, toAudioBuffer } from '../engine/audio';
import {
  defaultEffects,
  effectsFromPreset,
  FX_PRESETS,
  getEffectDef,
  hasActiveEffects,
  type EffectState,
} from '../engine/audio-fx';
import {
  hasActiveEdits,
  LOUDNESS_TARGETS,
  outToSource,
  sourceToOut,
  type AudioEdits,
  type EditPlan,
} from '../engine/audio-edit';
import { Compositor } from '../engine/compositor';
import { detectExportSupport, maxHeightForFps } from '../engine/export/capabilities';
import { exportMp4, type ExportProgress } from '../engine/export/mp4';
import { exportWebm } from '../engine/export/webm';
import { defaultConfig, type LayerConfig, type Schema } from '../engine/layers/api';
import {
  ASPECTS,
  defaultProject,
  defaultVisualizer,
  deserializeProject,
  exportSize,
  FRAME_RATES,
  MAX_VISUALIZERS,
  RESOLUTIONS,
  serializeProject,
  type FrameRate,
  type ProjectState,
} from '../engine/project';
import { toVtt, type CaptionTrack } from '../engine/captions';
import { BACKGROUNDS, getLayerDef, OVERLAYS, VISUALIZERS } from '../engine/registry';
import { demoGroove } from '../engine/testsignal';
import type { AudioSource, FeatureTrack, ThemeColors, ThemeScope } from '../engine/types';
import { getLocale, onLocaleChange, setLocale, t } from '../i18n';
import { getTheme, THEME_SCOPES, THEMES } from '../themes';
import { buildControls, type ControlsHost } from './controls';
import { clear, downloadBlob, el, formatTime, pickFile } from './dom';
import { ExportDialog } from './exportdialog';
import { WaveformStrip } from './waveformstrip';

export class App {
  private project: ProjectState = defaultProject();
  /** Original decoded audio — immutable; effects always process from this. */
  private sourceAudio: AudioSource | null = null;
  /** Audio after the effects chain — drives playback, features and export. */
  private audio: AudioSource | null = null;
  private features: FeatureTrack | null = null;
  private analysisToken = 0;
  private effectsTimer = 0;

  // Timeline editing
  /** Optional music bed mixed under the voice. */
  private bedAudio: AudioSource | null = null;
  /** Maps playback time ↔ source time across trims and silence cuts. */
  private editPlan: EditPlan | null = null;
  private loudnessGainDb = 0;

  // Transcription
  private captionModel = 'Xenova/whisper-tiny';
  private captionLang = 'auto';
  private transcribing = false;
  private transcribeStatus: string | null = null;

  // Playback
  private audioCtx: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private playing = false;
  private loop = false;
  private offset = 0; // seconds, position when paused / playback anchor
  private startedAt = 0; // audioCtx.currentTime when playback started

  // Rendering
  private compositor!: Compositor;
  private previewCanvas!: HTMLCanvasElement;
  private lastFrame = -1;
  private dirty = true;

  // DOM
  private root: HTMLElement;
  private stageWrap!: HTMLElement;
  private panel!: HTMLElement;
  private topbar!: HTMLElement;
  private transportBar!: HTMLElement;
  private dropOverlay!: HTMLElement;
  private timeLabel!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private strip = new WaveformStrip((srcSeconds) => this.seekSource(srcSeconds));
  private exportDialog = new ExportDialog();
  private toastEl!: HTMLElement;

  // Thumbnails
  private thumbCompositor: Compositor | null = null;
  private thumbCanvases = new Map<string, HTMLCanvasElement>();
  private thumbTimer = 0;

  private busy: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.previewCanvas = el('canvas', { className: 'preview-canvas', role: 'img', 'aria-label': t('a11y.canvas') });
    this.compositor = new Compositor(this.previewCanvas, this.scopeTheme('visualizer'));
    this.buildChrome();
    onLocaleChange(() => this.buildChrome());
    this.startLoop();
    this.bindKeyboard();
    this.updatePreviewSize();
  }

  // ---------------------------------------------------------------- chrome

  private buildChrome(): void {
    clear(this.root);
    this.topbar = this.buildTopbar();
    this.stageWrap = this.buildStage();
    this.panel = this.buildPanel();
    this.transportBar = this.buildTransport();
    this.toastEl = el('div', { className: 'toast', role: 'status', 'aria-live': 'polite' });

    const stageColumn = el('section', { className: 'stage' }, this.stageWrap, this.transportBar);
    this.root.append(
      this.topbar,
      el('main', { className: 'studio' }, stageColumn, this.panel),
      this.exportDialog.root,
      this.toastEl,
    );
    this.syncTransport();
    this.strip.setAudio(this.sourceAudio);
    if (this.editPlan) this.strip.setEditPlan(this.editPlan, this.project.edits);
    this.strip.setAccent(this.scopeTheme('app').a);
    this.strip.setPosition(this.currentTime());
    this.refreshThumbs();
  }

  private buildTopbar(): HTMLElement {
    const langSelect = el('select', {
      className: 'lang-select',
      'aria-label': t('a11y.language'),
      onchange: () => setLocale(langSelect.value as 'en' | 'pt-BR'),
    },
      el('option', { value: 'en', selected: getLocale() === 'en' }, 'EN'),
      el('option', { value: 'pt-BR', selected: getLocale() === 'pt-BR' }, 'PT'),
    );
    return el('header', { className: 'topbar' },
      el('div', { className: 'brand' },
        brandMark(),
        el('h1', { className: 'brand-name' }, 'Vox Orbita'),
        el('span', { className: 'brand-tagline' }, t('app.tagline')),
      ),
      el('div', { className: 'topbar-actions' },
        el('button', { className: 'btn btn-ghost', onclick: () => this.saveProject() }, t('project.save')),
        el('button', { className: 'btn btn-ghost', onclick: () => void this.loadProject() }, t('project.load')),
        langSelect,
        el('button', {
          className: 'btn btn-primary btn-export',
          onclick: () => void this.openExport(),
        }, t('export.button')),
      ),
    );
  }

  private buildStage(): HTMLElement {
    this.dropOverlay = el('div', { className: 'drop-overlay', hidden: this.audio !== null },
      el('div', { className: 'drop-inner' },
        brandMark(),
        el('h2', {}, t('drop.title')),
        el('p', {}, t('drop.hint')),
        el('div', { className: 'drop-actions' },
          el('button', {
            className: 'btn btn-primary',
            onclick: async () => {
              const file = await pickFile('audio/*,.mp3,.ogg,.wav,.m4a,.flac');
              if (file) void this.loadAudioFile(file);
            },
          }, t('drop.browse')),
          el('button', {
            className: 'btn btn-ghost',
            'data-demo': '1',
            onclick: () => void this.loadDemo(),
          }, t('drop.demo')),
        ),
      ),
    );

    const wrap = el('div', { className: 'stage-canvas-wrap', 'data-aspect': this.project.aspect },
      this.previewCanvas,
      this.dropOverlay,
    );
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrap.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.loadAudioFile(file);
    });
    return wrap;
  }

  private buildTransport(): HTMLElement {
    this.playBtn = el('button', {
      className: 'btn btn-icon',
      'aria-label': t('transport.play'),
      onclick: () => this.togglePlay(),
    }, playIcon());
    this.loopBtn = el('button', {
      className: 'btn btn-icon',
      'aria-label': t('transport.loop'),
      'aria-pressed': this.loop ? 'true' : 'false',
      onclick: () => {
        this.loop = !this.loop;
        this.loopBtn.setAttribute('aria-pressed', String(this.loop));
        this.loopBtn.classList.toggle('active', this.loop);
        if (this.sourceNode) this.sourceNode.loop = this.loop;
      },
    }, loopIcon());
    this.loopBtn.classList.toggle('active', this.loop);
    this.timeLabel = el('span', { className: 'time-label mono' }, '0:00');

    const meta = this.audio
      ? el('div', { className: 'audio-meta' },
          el('span', { className: 'audio-meta-name' }, this.audio.fileName),
          el('span', { className: 'mono' }, `${formatTime(this.audio.duration)} · ${(this.audio.sampleRate / 1000).toFixed(1)} kHz`),
          el('button', {
            className: 'btn btn-ghost btn-small',
            onclick: async () => {
              const file = await pickFile('audio/*,.mp3,.ogg,.wav,.m4a,.flac');
              if (file) void this.loadAudioFile(file);
            },
          }, t('transport.replace')),
        )
      : el('div', { className: 'audio-meta' });

    return el('div', { className: 'transport' },
      el('div', { className: 'transport-row' },
        this.playBtn,
        this.timeLabel,
        this.strip.root,
        el('span', { className: 'time-label mono' }, this.audio ? formatTime(this.audio.duration) : '–:––'),
        this.loopBtn,
      ),
      el('div', { className: 'transport-meta' },
        meta,
        el('span', { className: 'shortcut-hint' }, t('transport.shortcuts')),
      ),
    );
  }

  // ---------------------------------------------------------------- panel

  private activeTab: 'presets' | 'background' | 'overlays' | 'edit' | 'audio' | 'output' = 'presets';
  /** Index of the visualizer instance whose settings are shown. */
  private activeVis = 0;
  /** Which component the palette picker is currently targeting. */
  private themeScope: ThemeScope = 'app';

  /**
   * Timeline editing panel. Each edit group is a flat object, so the same
   * schema-driven control builder used by layers renders it — no bespoke
   * widgets. Every change reruns the audio pipeline (debounced).
   */
  private buildEditSections(): HTMLElement[] {
    const edits = this.project.edits;
    const rerun = () => this.schedulePipeline();
    const editHost = this.makeHost('app', rerun);
    const dur = this.sourceAudio?.duration ?? 60;

    const trimSchema = {
      trimStart: { kind: 'slider', min: 0, max: Math.max(1, dur), step: 0.05, def: 0, unit: 's' },
      trimEnd: { kind: 'slider', min: 0, max: Math.max(1, dur), step: 0.05, def: 0, unit: 's' },
      fadeIn: { kind: 'slider', min: 0, max: 10, step: 0.1, def: 0, unit: 's' },
      fadeOut: { kind: 'slider', min: 0, max: 10, step: 0.1, def: 0, unit: 's' },
    } satisfies Schema;

    const silenceSchema = {
      enabled: { kind: 'toggle', def: false },
      thresholdDb: { kind: 'slider', min: -80, max: -10, step: 1, def: -45, unit: 'dB' },
      minSilence: { kind: 'slider', min: 0.1, max: 5, step: 0.05, def: 0.5, unit: 's' },
      padding: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.15, unit: 's' },
    } satisfies Schema;

    const bedSchema = {
      enabled: { kind: 'toggle', def: false },
      intro: { kind: 'slider', min: 0, max: 30, step: 0.5, def: 3, unit: 's' },
      outro: { kind: 'slider', min: 0, max: 30, step: 0.5, def: 3, unit: 's' },
      gainDb: { kind: 'slider', min: -40, max: 0, step: 0.5, def: -12, unit: 'dB' },
      duckDb: { kind: 'slider', min: -40, max: 0, step: 0.5, def: -15, unit: 'dB' },
    } satisfies Schema;

    const loudnessSchema = {
      enabled: { kind: 'toggle', def: false },
      targetLufs: { kind: 'slider', min: -30, max: -8, step: 0.5, def: -16, unit: 'LUFS' },
    } satisfies Schema;

    // Trim shortcuts operating on the current playhead.
    const trimActions = el('div', { className: 'caption-actions' },
      el('button', {
        className: 'btn btn-ghost btn-small',
        onclick: () => {
          const src = this.playheadSource();
          if (src != null) {
            edits.trimStart = src;
            this.buildChrome();
            rerun();
          }
        },
      }, t('edit.setIn')),
      el('button', {
        className: 'btn btn-ghost btn-small',
        onclick: () => {
          const src = this.playheadSource();
          if (src != null) {
            edits.trimEnd = src;
            this.buildChrome();
            rerun();
          }
        },
      }, t('edit.setOut')),
      el('button', {
        className: 'btn btn-ghost btn-small',
        onclick: () => {
          edits.trimStart = 0;
          edits.trimEnd = 0;
          this.buildChrome();
          rerun();
        },
      }, t('edit.resetTrim')),
    );

    const loudnessPresets = el('div', { className: 'chip-row' },
      ...LOUDNESS_TARGETS.map((target) =>
        el('button', {
          className: `chip${edits.loudness.targetLufs === target.lufs ? ' selected' : ''}`,
          onclick: () => {
            edits.loudness.targetLufs = target.lufs;
            edits.loudness.enabled = true;
            this.buildChrome();
            rerun();
          },
        }, `${t(`loud.${target.id}`)} · ${target.lufs}`),
      ),
    );

    const bedRow = el('div', { className: 'caption-actions' },
      el('button', {
        className: 'btn btn-ghost btn-small',
        onclick: async () => {
          const file = await pickFile('audio/*,.mp3,.ogg,.wav,.m4a,.flac');
          if (!file) return;
          this.setBusy(t('drop.decoding'));
          try {
            this.bedAudio = await decodeAudioFile(file, file.name);
            edits.bed.enabled = true;
            this.buildChrome();
            rerun();
          } catch {
            this.toast(t('drop.invalid'));
          } finally {
            this.setBusy(null);
          }
        },
      }, t('edit.chooseBed')),
      el('span', { className: 'image-name' }, this.bedAudio?.fileName ?? ''),
    );

    return [
      section(t('edit.trim'),
        el('p', { className: 'panel-hint' }, t('edit.hint')),
        buildControls(trimSchema, edits as unknown as LayerConfig, editHost, 'edit-trim'),
        trimActions,
        el('p', { className: 'caption-status edit-status' }, this.editStatusText()),
      ),
      section(t('edit.silence'),
        buildControls(silenceSchema, edits.silence as unknown as LayerConfig, editHost, 'edit-sil'),
      ),
      section(t('edit.bed'),
        el('p', { className: 'panel-hint' }, t('edit.bedHint')),
        bedRow,
        buildControls(bedSchema, edits.bed as unknown as LayerConfig, editHost, 'edit-bed'),
      ),
      section(t('edit.loudness'),
        el('p', { className: 'panel-hint' }, t('edit.loudHint')),
        loudnessPresets,
        buildControls(loudnessSchema, edits.loudness as unknown as LayerConfig, editHost, 'edit-loud'),
      ),
    ];
  }

  /** Seek by SOURCE time (what the waveform strip shows). */
  private seekSource(srcTime: number): void {
    this.seek(this.editPlan ? sourceToOut(this.editPlan, srcTime) : srcTime);
  }

  /** Current playhead expressed in SOURCE time (null inside a bed-only span). */
  private playheadSource(): number | null {
    if (!this.editPlan) return this.currentTime();
    return outToSource(this.editPlan, this.currentTime());
  }

  private editStatusText(): string {
    if (!this.editPlan) return '';
    const { srcDuration, outDuration, removed } = this.editPlan;
    const saved = Math.max(0, srcDuration - outDuration);
    const parts = [`${formatTime(srcDuration)} → ${formatTime(outDuration)}`];
    if (removed.length > 0) parts.push(t('edit.cuts', { n: String(removed.length), s: formatTime(saved) }));
    if (this.loudnessGainDb !== 0) parts.push(`${this.loudnessGainDb > 0 ? '+' : ''}${this.loudnessGainDb.toFixed(1)} dB`);
    return parts.join(' · ');
  }

  private refreshEditStatus(): void {
    const node = this.root.querySelector('.edit-status');
    if (node) node.textContent = this.editStatusText();
  }

  /** Colors for one theme scope (app chrome, background, visualizer, overlay). */
  private scopeTheme(scope: ThemeScope): ThemeColors {
    return getTheme(this.project.themes[scope]).colors;
  }

  /** Controls host bound to a scope, so color swatches show that palette. */
  private makeHost(scope: ThemeScope, onChange: () => void = () => this.invalidate()): ControlsHost {
    return {
      getTheme: () => this.scopeTheme(scope),
      getThemeId: () => this.project.themes[scope],
      onChange,
    };
  }

  private buildPanel(): HTMLElement {
    const host = this.makeHost('visualizer');
    const bgHost = this.makeHost('background');
    const overlayHost = this.makeHost('overlay');

    const panel = el('aside', { className: 'panel' });

    // --- Tab bar: one tab per customizable element of the animation ---
    const tabIds = ['presets', 'background', 'overlays', 'edit', 'audio', 'output'] as const;
    const tabButtons = new Map<string, HTMLButtonElement>();
    const tabPanels = new Map<string, HTMLElement>();

    const selectTab = (id: (typeof tabIds)[number]) => {
      this.activeTab = id;
      for (const tid of tabIds) {
        const btn = tabButtons.get(tid)!;
        const body = tabPanels.get(tid)!;
        const active = tid === id;
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
        body.hidden = !active;
      }
    };

    const tabbar = el('div', { className: 'panel-tabs', role: 'tablist' });
    for (const id of tabIds) {
      const btn = el('button', {
        className: 'ptab',
        role: 'tab',
        id: `ptab-${id}`,
        'aria-controls': `ppanel-${id}`,
        onclick: () => selectTab(id),
      }, t(`panel.${id}`));
      tabButtons.set(id, btn);
      tabbar.append(btn);
    }
    tabbar.addEventListener('keydown', (e) => {
      const idx = tabIds.indexOf(this.activeTab);
      let next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % tabIds.length;
      else if (e.key === 'ArrowLeft') next = (idx + tabIds.length - 1) % tabIds.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabIds.length - 1;
      if (next >= 0) {
        e.preventDefault();
        selectTab(tabIds[next]);
        tabButtons.get(tabIds[next])!.focus();
      }
    });
    panel.append(tabbar);

    const addTabPanel = (id: (typeof tabIds)[number], ...children: HTMLElement[]) => {
      const body = el('div', {
        className: 'panel-tab-body',
        role: 'tabpanel',
        id: `ppanel-${id}`,
        'aria-labelledby': `ptab-${id}`,
      }, ...children);
      tabPanels.set(id, body);
      panel.append(body);
    };

    // --- Visualizer instances (stackable, individually placed) ---
    this.activeVis = Math.min(this.activeVis, this.project.visualizers.length - 1);
    const active = this.project.visualizers[this.activeVis];

    // A button group (select / remove / add), not a single-select listbox —
    // it holds add/remove controls too, so `group` is the correct role.
    const instanceRow = el('div', { className: 'chip-row instance-row', role: 'group', 'aria-label': t('vis.active') });
    this.project.visualizers.forEach((vis, i) => {
      const chip = el('button', {
        className: `chip${i === this.activeVis ? ' selected' : ''}`,
        'aria-pressed': String(i === this.activeVis),
        onclick: () => {
          this.activeVis = i;
          this.buildChrome();
        },
      }, `${i + 1} · ${t(`layer.${vis.id}`)}`);
      instanceRow.append(chip);
      if (this.project.visualizers.length > 1) {
        instanceRow.append(el('button', {
          className: 'chip chip-remove',
          'aria-label': `${t('vis.remove')} ${i + 1}`,
          onclick: () => {
            this.project.visualizers.splice(i, 1);
            this.activeVis = Math.max(0, this.activeVis - (i <= this.activeVis ? 1 : 0));
            this.buildChrome();
            this.invalidate();
          },
        }, '×'));
      }
    });
    if (this.project.visualizers.length < MAX_VISUALIZERS) {
      instanceRow.append(el('button', {
        className: 'chip chip-add',
        onclick: () => {
          this.project.visualizers.push(defaultVisualizer());
          this.activeVis = this.project.visualizers.length - 1;
          this.buildChrome();
          this.invalidate();
        },
      }, `+ ${t('vis.add')}`));
    }

    const thumbs = el('div', { className: 'thumb-grid', role: 'listbox', 'aria-label': t('panel.presets') });
    this.thumbCanvases.clear();
    for (const def of VISUALIZERS) {
      const canvas = el('canvas', { className: 'thumb-canvas', width: '192', height: '108' });
      this.thumbCanvases.set(def.id, canvas);
      const btn = el('button', {
        className: `thumb${active.id === def.id ? ' selected' : ''}`,
        role: 'option',
        'aria-selected': String(active.id === def.id),
        onclick: () => {
          // Switch the *selected instance* to this preset, keeping placement.
          const target = this.project.visualizers[this.activeVis];
          target.id = def.id;
          target.config = defaultConfig(def.schema);
          target.enabled = true;
          this.buildChrome();
          this.invalidate();
        },
      }, canvas, el('span', { className: 'thumb-label' }, t(`layer.${def.id}`)));
      thumbs.append(btn);
    }
    const visDef = getLayerDef(active.id)!;
    addTabPanel('presets',
      section(t('vis.active'), instanceRow, thumbs),
      section(t('vis.placement'), buildControls(PLACEMENT_SCHEMA, active.placement as unknown as LayerConfig, host, `vis-place-${this.activeVis}`)),
      section(t(`layer.${visDef.id}`), buildControls(visDef.schema, active.config, host, 'vis')),
    );

    // --- Background ---
    const bgChips = el('div', { className: 'chip-row', role: 'listbox', 'aria-label': t('panel.background') });
    for (const def of BACKGROUNDS) {
      bgChips.append(el('button', {
        className: `chip${this.project.background.id === def.id ? ' selected' : ''}`,
        role: 'option',
        'aria-selected': String(this.project.background.id === def.id),
        onclick: () => {
          this.project.background = { id: def.id, enabled: true, config: defaultConfig(def.schema) };
          this.buildChrome();
          this.invalidate();
        },
      }, t(`layer.${def.id}`)));
    }
    const bgDef = getLayerDef(this.project.background.id)!;
    addTabPanel('background',
      section(t('panel.background'), bgChips),
      section(t(`layer.${bgDef.id}`), buildControls(bgDef.schema, this.project.background.config, bgHost, 'bg')),
    );

    // --- Overlays ---
    const overlayWrap = el('div', {});
    for (const state of this.project.overlays) {
      const def = getLayerDef(state.id)!;
      const toggleId = `ov-enable-${state.id}`;
      const toggle = el('input', {
        id: toggleId,
        type: 'checkbox',
        onchange: () => {
          state.enabled = toggle.checked;
          body.hidden = !state.enabled;
          this.invalidate();
        },
      });
      toggle.checked = state.enabled;
      const body = el('div', { className: 'overlay-body' }, buildControls(def.schema, state.config, overlayHost, state.id));
      body.hidden = !state.enabled;
      overlayWrap.append(el('div', { className: 'overlay-group' },
        el('div', { className: 'overlay-head' },
          el('label', { className: 'overlay-title', for: toggleId }, t(`layer.${state.id}`)),
          el('span', { className: 'switch' }, toggle, el('span', { className: 'switch-track', 'aria-hidden': 'true' })),
        ),
        body,
      ));
    }
    addTabPanel('overlays', this.buildCaptionsSection(), section(t('panel.overlays'), overlayWrap));

    addTabPanel('edit', ...this.buildEditSections());

    // --- Audio effects ---
    // Effect controls reprocess the audio (debounced) rather than just
    // re-rendering, so they use a host that schedules `applyPipeline`.
    const audioHost = this.makeHost('app', () => this.schedulePipeline());

    const presetRow = el('div', { className: 'chip-row', role: 'group', 'aria-label': t('audio.presets') });
    presetRow.append(el('button', {
      className: 'chip',
      onclick: () => {
        for (const fx of this.project.effects) fx.enabled = false;
        this.buildChrome();
        this.schedulePipeline();
      },
    }, t('audio.none')));
    for (const p of FX_PRESETS) {
      presetRow.append(el('button', {
        className: 'chip',
        onclick: () => {
          this.project.effects = effectsFromPreset(p);
          this.buildChrome();
          this.schedulePipeline();
        },
      }, t(`fxpreset.${p.id}`)));
    }

    const fxWrap = el('div', {});
    for (const state of this.project.effects) {
      const def = getEffectDef(state.id)!;
      const toggleId = `fx-enable-${state.id}`;
      const toggle = el('input', {
        id: toggleId,
        type: 'checkbox',
        onchange: () => {
          state.enabled = toggle.checked;
          body.hidden = !state.enabled;
          this.schedulePipeline();
        },
      });
      toggle.checked = state.enabled;
      const body = el('div', { className: 'overlay-body' }, buildControls(def.schema, state.config, audioHost, state.id));
      body.hidden = !state.enabled;
      fxWrap.append(el('div', { className: 'overlay-group' },
        el('div', { className: 'overlay-head' },
          el('label', { className: 'overlay-title', for: toggleId }, t(`fx.${state.id}`)),
          el('span', { className: 'switch' }, toggle, el('span', { className: 'switch-track', 'aria-hidden': 'true' })),
        ),
        body,
      ));
    }
    addTabPanel('audio',
      section(t('audio.presets'), presetRow, el('p', { className: 'panel-hint' }, t('audio.hint'))),
      section(t('audio.chain'), fxWrap),
    );

    // --- Palette: pick a component, then a palette for it ---
    const scopeSeg = segmented(
      THEME_SCOPES.map((s) => t(`scope.${s}`)),
      t(`scope.${this.themeScope}`),
      (label) => {
        const found = THEME_SCOPES.find((s) => t(`scope.${s}`) === label);
        if (found) {
          this.themeScope = found;
          this.buildChrome();
        }
      },
    );
    const swatches = el('div', { className: 'theme-row', role: 'listbox', 'aria-label': t('panel.theme') });
    for (const theme of THEMES) {
      const selected = this.project.themes[this.themeScope] === theme.id;
      swatches.append(el('button', {
        className: `theme-swatch${selected ? ' selected' : ''}`,
        role: 'option',
        'aria-selected': String(selected),
        'aria-label': t(`theme.${theme.id}`),
        title: t(`theme.${theme.id}`),
        style: `--ta:${theme.colors.a};--tb:${theme.colors.b};--tc:${theme.colors.c}`,
        onclick: () => {
          this.project.themes[this.themeScope] = theme.id;
          this.applyAppTheme();
          this.buildChrome();
          this.invalidate();
        },
      }));
    }
    const paletteSection = section(t('panel.theme'),
      el('div', { className: 'field' }, el('label', {}, t('scope.component')), scopeSeg),
      swatches,
      el('p', { className: 'panel-hint' }, t('scope.hint')),
    );

    // --- Output ---
    const aspectSeg = segmented(Object.keys(ASPECTS), this.project.aspect, (v) => {
      this.project.aspect = v as ProjectState['aspect'];
      this.stageWrap.dataset.aspect = v;
      this.updatePreviewSize();
      this.invalidate();
    });
    const fpsSeg = segmented(FRAME_RATES.map(String), String(this.project.fps), (v) => {
      this.project.fps = Number(v) as FrameRate;
      // High frame rates exceed encoder levels at 4K — clamp and rebuild.
      const cap = maxHeightForFps(this.project.fps);
      if (this.project.resolution > cap) this.project.resolution = cap;
      this.buildChrome();
      void this.applyPipeline();
    });
    const resSelect = el('select', {
      id: 'res-select',
      onchange: () => {
        this.project.resolution = Number(resSelect.value);
      },
    });
    const resCap = maxHeightForFps(this.project.fps);
    for (const r of RESOLUTIONS) {
      if (r > resCap) continue;
      resSelect.append(el('option', { value: String(r), selected: this.project.resolution === r }, r === 2160 ? '4K (2160p)' : `${r}p`));
    }
    addTabPanel('output',
      paletteSection,
      section(t('panel.output'),
        el('div', { className: 'field' }, el('label', {}, t('output.aspect')), aspectSeg),
        el('div', { className: 'field' }, el('label', { for: 'res-select' }, t('output.resolution')), resSelect),
        el('div', { className: 'field' }, el('label', {}, t('output.fps')), fpsSeg),
        this.project.fps >= 120 ? el('p', { className: 'panel-hint' }, t('output.fpsNote')) : el('span', {}),
      ),
    );

    selectTab(this.activeTab);
    return panel;
  }

  // ---------------------------------------------------------------- audio

  async loadAudioFile(file: File): Promise<void> {
    this.setBusy(t('drop.decoding'));
    try {
      const audio = await decodeAudioFile(file, file.name);
      await this.setAudio(audio);
    } catch {
      this.toast(t('drop.invalid'));
    } finally {
      this.setBusy(null);
    }
  }

  async loadDemo(): Promise<void> {
    this.setBusy(t('drop.decoding'));
    try {
      await this.setAudio(demoGroove());
    } finally {
      this.setBusy(null);
    }
  }

  private async setAudio(source: AudioSource): Promise<void> {
    this.stopPlayback();
    this.sourceAudio = source;
    this.offset = 0;
    this.project.audioFileName = source.fileName;
    await this.applyPipeline();
    this.buildChrome();
    this.invalidate();
  }

  /** Debounced trigger for effect-control changes during editing. */
  private schedulePipeline(): void {
    if (this.effectsTimer) clearTimeout(this.effectsTimer);
    this.effectsTimer = window.setTimeout(() => {
      this.effectsTimer = 0;
      void this.applyPipeline();
    }, 260);
  }

  /**
   * Run the whole offline audio pipeline in a worker:
   *   source → timeline edits → effects → loudness → features
   * Always starts from the immutable source, so edits are never cumulative.
   * Playback position is preserved across the swap.
   */
  private applyPipeline(): Promise<void> {
    const source = this.sourceAudio;
    if (!source) return Promise.resolve();
    const token = ++this.analysisToken;
    const wasPlaying = this.playing;
    const resumeAt = this.currentTime();
    const busy = hasActiveEffects(this.project.effects) || hasActiveEdits(this.project.edits);
    this.setBusy(t(busy ? 'drop.processing' : 'drop.analyzing'));

    return new Promise((resolve) => {
      const worker = new Worker(new URL('./audiofx.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{
        channels: Float32Array[];
        features: FeatureTrack;
        plan: EditPlan;
        loudnessGainDb: number;
      }>) => {
        worker.terminate();
        if (token !== this.analysisToken) return resolve();
        const processed = fromChannels(e.data.channels, source.sampleRate, source.fileName);
        this.audio = processed;
        this.features = e.data.features;
        this.editPlan = e.data.plan;
        this.loudnessGainDb = e.data.loudnessGainDb;
        this.compositor.features = this.features;
        this.compositor.audio = processed;
        this.compositor.fps = this.project.fps;
        this.setBusy(null);
        // The strip shows the SOURCE waveform with cut/trim regions drawn on
        // it; the playhead is mapped through the edit plan.
        this.strip.setAudio(source);
        this.strip.setEditPlan(e.data.plan, this.project.edits);
        this.invalidate();
        this.refreshThumbs();
        this.refreshEditStatus();
        // Resume playback on the freshly rendered buffer at the same spot.
        if (wasPlaying) {
          this.stopSource();
          this.playing = false;
          this.offset = Math.min(resumeAt, processed.duration);
          this.play();
        }
        resolve();
      };
      const channels = source.channels.map((c) => c.slice());
      const bed = this.bedAudio ? this.bedAudio.channels.map((c) => c.slice()) : null;
      worker.postMessage(
        {
          channels,
          sampleRate: source.sampleRate,
          fps: this.project.fps,
          effects: this.project.effects,
          edits: this.project.edits,
          bed,
        },
        [...channels.map((c) => c.buffer), ...(bed ? bed.map((c) => c.buffer) : [])],
      );
    });
  }

  // ---------------------------------------------------------------- captions

  /**
   * Transcribe the (processed) audio with Whisper in a worker. The model is
   * fetched from the HF CDN once; the audio stays local. On success the
   * caption track is stored and the caption overlay is enabled.
   */
  transcribe(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.transcribing) return Promise.resolve();
    this.transcribing = true;
    this.transcribeStatus = t('cap.loading');
    this.refreshCaptionUi();

    return new Promise((resolve) => {
      const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<
        | { type: 'progress'; stage: string; ratio: number | null }
        | { type: 'done'; track: import('../engine/captions').CaptionTrack }
        | { type: 'error'; message: string }
      >) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          const pct = msg.ratio != null ? ` ${Math.round(msg.ratio * 100)}%` : '';
          this.transcribeStatus = t(`cap.${msg.stage === 'download' ? 'downloading' : msg.stage === 'transcribe' ? 'transcribing' : 'loading'}`) + pct;
          this.refreshCaptionUi();
        } else if (msg.type === 'done') {
          worker.terminate();
          this.transcribing = false;
          this.project.captions = msg.track;
          // Auto-enable the caption overlay so results are visible immediately.
          const capOverlay = this.project.overlays.find((o) => o.id === 'ov-captions');
          if (capOverlay) capOverlay.enabled = true;
          const count = msg.track.lines.length;
          this.transcribeStatus = count > 0 ? t('cap.done', { n: String(count) }) : t('cap.empty');
          this.buildChrome();
          this.invalidate();
          resolve();
        } else {
          worker.terminate();
          this.transcribing = false;
          this.transcribeStatus = `${t('cap.failed')}: ${msg.message}`;
          this.refreshCaptionUi();
          resolve();
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        this.transcribing = false;
        this.transcribeStatus = `${t('cap.failed')}: ${err.message}`;
        this.refreshCaptionUi();
        resolve();
      };
      const mono = audio.mono.slice();
      worker.postMessage(
        { mono, sampleRate: audio.sampleRate, model: this.captionModel, language: this.captionLang },
        [mono.buffer],
      );
    });
  }

  private clearCaptions(): void {
    this.project.captions = null;
    this.transcribeStatus = null;
    this.buildChrome();
    this.invalidate();
  }

  /** Update just the transcription status line without a full rebuild. */
  private refreshCaptionUi(): void {
    const statusEl = this.root.querySelector('.caption-status');
    if (statusEl) statusEl.textContent = this.transcribeStatus ?? '';
    const btn = this.root.querySelector<HTMLButtonElement>('.caption-transcribe');
    if (btn) btn.disabled = this.transcribing;
  }

  /** The "Captions" section (transcribe action) at the top of the Overlays tab. */
  private buildCaptionsSection(): HTMLElement {
    const modelSelect = el('select', {
      'aria-label': t('cap.quality'),
      onchange: () => (this.captionModel = modelSelect.value),
    },
      el('option', { value: 'Xenova/whisper-tiny', selected: this.captionModel === 'Xenova/whisper-tiny' }, t('cap.fast')),
      el('option', { value: 'Xenova/whisper-base', selected: this.captionModel === 'Xenova/whisper-base' }, t('cap.accurate')),
    );
    const langSelect = el('select', {
      'aria-label': t('cap.language'),
      onchange: () => (this.captionLang = langSelect.value),
    },
      el('option', { value: 'auto', selected: this.captionLang === 'auto' }, t('cap.auto')),
      el('option', { value: 'en', selected: this.captionLang === 'en' }, 'English'),
      el('option', { value: 'pt', selected: this.captionLang === 'pt' }, 'Português'),
    );

    const transcribeBtn = el('button', {
      className: 'btn btn-primary caption-transcribe',
      disabled: this.transcribing || !this.audio,
      onclick: () => void this.transcribe(),
    }, this.project.captions ? t('cap.retranscribe') : t('cap.transcribe'));

    const actions = el('div', { className: 'caption-actions' }, transcribeBtn);
    if (this.project.captions) {
      actions.append(
        el('button', {
          className: 'btn btn-ghost btn-small',
          onclick: () => downloadBlob(new Blob([toVtt(this.project.captions!)], { type: 'text/vtt' }), 'captions.vtt'),
        }, t('cap.exportVtt')),
        el('button', { className: 'btn btn-ghost btn-small', onclick: () => this.clearCaptions() }, t('cap.clear')),
      );
    }

    return section(t('panel.captions'),
      el('p', { className: 'panel-hint' }, t('cap.hint')),
      el('div', { className: 'field' }, el('label', {}, t('cap.quality')), modelSelect),
      el('div', { className: 'field' }, el('label', {}, t('cap.language')), langSelect),
      actions,
      el('p', { className: 'caption-status', role: 'status', 'aria-live': 'polite' }, this.transcribeStatus ?? ''),
    );
  }

  // ---------------------------------------------------------------- playback

  private ensureCtx(): AudioContext {
    this.audioCtx ??= new AudioContext();
    return this.audioCtx;
  }

  currentTime(): number {
    if (!this.audio) return 0;
    if (!this.playing || !this.audioCtx) return this.offset;
    const t0 = this.audioCtx.currentTime - this.startedAt + this.offset;
    return this.loop ? t0 % this.audio.duration : Math.min(t0, this.audio.duration);
  }

  togglePlay(): void {
    if (!this.audio) return;
    if (this.playing) this.pause();
    else this.play();
  }

  private play(): void {
    if (!this.audio) return;
    const ctx = this.ensureCtx();
    void ctx.resume();
    if (this.offset >= this.audio.duration - 0.01) this.offset = 0;
    this.stopSource();
    const node = ctx.createBufferSource();
    node.buffer = toAudioBuffer(this.audio, ctx);
    node.loop = this.loop;
    node.connect(ctx.destination);
    node.start(0, this.offset % this.audio.duration);
    node.onended = () => {
      if (this.sourceNode === node && !this.loop) {
        this.offset = this.audio?.duration ?? 0;
        this.playing = false;
        this.syncTransport();
      }
    };
    this.sourceNode = node;
    this.startedAt = ctx.currentTime;
    this.playing = true;
    this.syncTransport();
  }

  private pause(): void {
    this.offset = this.currentTime();
    this.stopSource();
    this.playing = false;
    this.syncTransport();
  }

  seek(seconds: number): void {
    if (!this.audio) return;
    const target = Math.min(Math.max(0, seconds), this.audio.duration);
    const wasPlaying = this.playing;
    this.stopSource();
    this.playing = false;
    this.offset = target;
    if (wasPlaying) this.play();
    this.invalidate();
    this.scheduleThumbRefresh();
  }

  private stopSource(): void {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try { this.sourceNode.stop(); } catch { /* not started */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  private stopPlayback(): void {
    this.stopSource();
    this.playing = false;
    this.offset = 0;
  }

  private syncTransport(): void {
    if (!this.playBtn) return;
    this.playBtn.setAttribute('aria-label', this.playing ? t('transport.pause') : t('transport.play'));
    clear(this.playBtn);
    this.playBtn.append(this.playing ? pauseIcon() : playIcon());
  }

  // ---------------------------------------------------------------- render loop

  private invalidate(): void {
    this.dirty = true;
  }

  /** Push the "app" scope accent into the CSS chrome. */
  private applyAppTheme(): void {
    document.documentElement.style.setProperty('--accent', this.scopeTheme('app').a);
  }

  private startLoop(): void {
    const tick = () => {
      requestAnimationFrame(tick);
      const time = this.currentTime();
      // Fractional frame: the preview interpolates between analysis frames,
      // so a 30 fps project still animates fluidly on a 60/120 Hz display.
      // Export renders integer frames only — determinism is untouched.
      const frame = this.features ? Math.min(this.features.frameCount - 1, time * this.project.fps) : 0;
      if (this.playing || this.dirty || frame !== this.lastFrame) {
        this.compositor.fps = this.project.fps;
        this.compositor.theme = this.scopeTheme('visualizer');
        this.compositor.captions = this.project.captions;
        this.syncStack();
        this.compositor.renderFrame(frame);
        this.lastFrame = frame;
        this.dirty = false;
      }
      if (this.audio) {
        this.strip.setPosition(this.editPlan ? outToSource(this.editPlan, time) ?? 0 : time);
        if (this.timeLabel) this.timeLabel.textContent = formatTime(time);
        if (this.playing && this.thumbTimer === 0) this.scheduleThumbRefresh();
      }
    };
    requestAnimationFrame(tick);
  }

  private buildStack(): Compositor['stack'] {
    // Each layer carries its scope palette, so background / visualizers /
    // overlays can use different themes in the same frame.
    return [
      {
        def: getLayerDef(this.project.background.id)!,
        config: this.project.background.config,
        enabled: true,
        theme: this.scopeTheme('background'),
      },
      ...this.project.visualizers.map((v) => ({
        def: getLayerDef(v.id)!,
        config: v.config,
        enabled: v.enabled,
        placement: v.placement,
        theme: this.scopeTheme('visualizer'),
      })),
      ...this.project.overlays.map((o) => ({
        def: getLayerDef(o.id)!,
        config: o.config,
        enabled: o.enabled,
        theme: this.scopeTheme('overlay'),
      })),
    ];
  }

  private syncStack(): void {
    this.compositor.stack = this.buildStack();
  }

  private updatePreviewSize(): void {
    const ratio = ASPECTS[this.project.aspect];
    // Preview renders at a fixed logical resolution per aspect; CSS scales it.
    const height = ratio >= 1 ? 720 : 960;
    const width = 2 * Math.round((height * ratio) / 2);
    this.compositor.setSize(width, height);
    this.invalidate();
  }

  // ---------------------------------------------------------------- thumbnails

  private scheduleThumbRefresh(): void {
    if (this.thumbTimer) return;
    this.thumbTimer = window.setTimeout(() => {
      this.thumbTimer = 0;
      this.refreshThumbs();
    }, 400);
  }

  private refreshThumbs(): void {
    if (!this.features || !this.audio) return;
    if (!this.thumbCompositor) {
      this.thumbCompositor = new Compositor(new OffscreenCanvas(192, 108), this.scopeTheme('visualizer'));
      this.thumbCompositor.setSize(192, 108);
    }
    const tc = this.thumbCompositor;
    tc.features = this.features;
    tc.audio = this.audio;
    tc.fps = this.project.fps;
    tc.theme = this.scopeTheme('visualizer');
    const frame = Math.min(this.features.frameCount - 1, Math.floor(this.currentTime() * this.project.fps));
    for (const def of VISUALIZERS) {
      const canvas = this.thumbCanvases.get(def.id);
      if (!canvas || !canvas.isConnected) continue;
      tc.stack = [
        { def: getLayerDef(this.project.background.id)!, config: this.project.background.config, enabled: true },
        { def, config: defaultConfig(def.schema), enabled: true },
      ];
      tc.renderFrame(frame);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(tc.canvas as OffscreenCanvas, 0, 0, canvas.width, canvas.height);
    }
  }

  // ---------------------------------------------------------------- export

  async openExport(): Promise<void> {
    if (!this.audio || !this.features) {
      this.toast(t('export.needAudio'));
      return;
    }
    const audio = this.audio;
    const { width, height } = exportSize(this.project);
    const support = await detectExportSupport(width, height, this.project.fps);
    const baseName = (audio.fileName.replace(/\.[^.]+$/, '') || 'vox-orbita') + `-${height}p`;

    this.exportDialog.open({
      fileName: baseName,
      support,
      summary: `${width}×${height} · ${this.project.fps} fps · ${formatTime(audio.duration)} · ${audio.fileName}`,
      run: async (onProgress, signal) => {
        this.pause();
        const canvas = new OffscreenCanvas(width, height);
        const comp = new Compositor(canvas, this.scopeTheme('visualizer'));
        comp.setSize(width, height);
        comp.features = this.features;
        comp.audio = audio;
        comp.captions = this.project.captions;
        comp.fps = this.project.fps;
        comp.stack = this.buildStack();
        try {
          if (support.kind === 'mp4') {
            return await exportMp4({ compositor: comp, audio, fps: this.project.fps, width, height, support, signal, onProgress });
          }
          if (support.kind === 'webm') {
            // MediaRecorder needs an on-screen canvas stream: reuse preview compositor at full res.
            return await this.exportWebmFallback(onProgress, signal);
          }
          throw new Error(t('export.noneNotice'));
        } finally {
          comp.dispose();
        }
      },
    });
  }

  private async exportWebmFallback(onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<Blob> {
    const audio = this.audio!;
    return exportWebm({ compositor: this.compositor, audio, fps: this.project.fps, signal, onProgress });
  }

  // ---------------------------------------------------------------- project io

  private saveProject(): void {
    const json = serializeProject(this.project);
    downloadBlob(new Blob([json], { type: 'application/json' }), 'project.voxorbita.json');
  }

  private async loadProject(): Promise<void> {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const { state, missingImages, audioFileName } = deserializeProject(await file.text());
      state.audioFileName = this.sourceAudio?.fileName ?? audioFileName;
      this.project = state;
      this.applyAppTheme();
      this.updatePreviewSize();
      await this.applyPipeline();
      this.buildChrome();
      this.invalidate();
      const notes: string[] = [];
      if (missingImages.length) notes.push(t('project.missingImages') + missingImages.join(', '));
      if (audioFileName && audioFileName !== this.audio?.fileName) notes.push(t('project.missingAudio') + audioFileName);
      if (notes.length) this.toast(notes.join(' — '));
    } catch {
      this.toast(t('project.loadError'));
    }
  }

  // ---------------------------------------------------------------- misc

  private bindKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea, dialog')) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const step = e.shiftKey ? 1 / this.project.fps : 5;
        this.seek(this.currentTime() + dir * step);
      } else if (e.key.toLowerCase() === 'l') {
        this.loopBtn?.click();
      }
    });
  }

  private setBusy(message: string | null): void {
    this.busy?.remove();
    this.busy = null;
    if (message) {
      this.busy = el('div', { className: 'busy-badge', role: 'status' }, el('span', { className: 'spinner', 'aria-hidden': 'true' }), message);
      this.stageWrap.append(this.busy);
    }
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.setTimeout(() => this.toastEl.classList.remove('show'), 6000);
  }

  // Exposed for the Playwright smoke test (and console debugging).
  readonly testApi = {
    loadDemo: () => this.loadDemo(),
    getLastExport: () => this.exportDialog.lastBlob,
    hasFeatures: () => this.features !== null,
    /** Apply an FX preset by id and await processing (bypasses debounce). */
    applyFxPreset: async (id: string): Promise<void> => {
      const p = FX_PRESETS.find((x) => x.id === id);
      this.project.effects = p ? effectsFromPreset(p) : defaultEffects();
      this.buildChrome();
      await this.applyPipeline();
    },
    /** Fingerprint the currently processed audio (rms/peak/length). */
    audioFingerprint: (): { rms: number; peak: number; length: number } | null => {
      if (!this.audio) return null;
      const ch = this.audio.mono;
      let sq = 0;
      let peak = 0;
      for (let i = 0; i < ch.length; i++) {
        sq += ch[i] * ch[i];
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
      }
      return { rms: Math.sqrt(sq / ch.length), peak, length: ch.length };
    },
    effectsEnabledCount: (): number => this.project.effects.filter((e) => e.enabled).length,
    seek: (s: number) => this.seek(s),
    setResolution: (r: number) => {
      this.project.resolution = r;
    },
    /** Render one frame through the export code path; returns a PNG data URL. */
    renderFrameTo: async (frame: number, width: number, height: number): Promise<string> => {
      if (!this.features || !this.audio) throw new Error('no audio loaded');
      const canvas = new OffscreenCanvas(width, height);
      const comp = new Compositor(canvas, this.scopeTheme('visualizer'));
      comp.setSize(width, height);
      comp.features = this.features;
      comp.audio = this.audio;
      comp.captions = this.project.captions;
      comp.fps = this.project.fps;
      comp.stack = this.buildStack();
      comp.renderFrame(frame);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      comp.dispose();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    },
    /** Render one frame on the live preview compositor; returns a PNG data URL. */
    previewFrameTo: async (frame: number): Promise<string> => {
      if (!this.features || !this.audio) throw new Error('no audio loaded');
      this.compositor.fps = this.project.fps;
      this.compositor.theme = this.scopeTheme('visualizer');
      this.compositor.captions = this.project.captions;
      this.syncStack();
      this.compositor.renderFrame(frame);
      const blob = await new Promise<Blob>((resolve, reject) =>
        this.previewCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      );
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    },
    /** Replace the visualizer stack with placed instances (for tests). */
    setVisualizers: (specs: Array<{ id: string; x?: number; y?: number; scale?: number }>): void => {
      this.project.visualizers = specs.map((s) => {
        const v = defaultVisualizer(s.id);
        v.placement = { x: s.x ?? 0.5, y: s.y ?? 0.5, scale: s.scale ?? 1 };
        return v;
      });
      this.activeVis = 0;
      this.buildChrome();
      this.invalidate();
    },
    visualizerCount: (): number => this.project.visualizers.length,
    /** Apply timeline edits and await the pipeline (bypasses the debounce). */
    setEdits: async (patch: Partial<AudioEdits>): Promise<void> => {
      Object.assign(this.project.edits, patch);
      this.buildChrome();
      await this.applyPipeline();
    },
    /** Duration / loudness of the rendered audio, for assertions. */
    audioInfo: (): { duration: number; outDuration: number; cuts: number; loudnessGainDb: number } | null => {
      if (!this.audio) return null;
      return {
        duration: this.audio.duration,
        outDuration: this.editPlan?.outDuration ?? this.audio.duration,
        cuts: this.editPlan?.removed.length ?? 0,
        loudnessGainDb: this.loudnessGainDb,
      };
    },
    setFps: (fps: number): void => {
      this.project.fps = fps as FrameRate;
      const cap = maxHeightForFps(this.project.fps);
      if (this.project.resolution > cap) this.project.resolution = cap;
    },
    setThemeScope: (scope: ThemeScope, id: string): void => {
      this.project.themes[scope] = id;
      this.applyAppTheme();
      this.buildChrome();
      this.invalidate();
    },
    /** Inject a caption track + enable the caption overlay (bypasses Whisper). */
    setCaptions: (track: CaptionTrack | null): void => {
      this.project.captions = track;
      const cap = this.project.overlays.find((o) => o.id === 'ov-captions');
      if (cap) cap.enabled = track !== null;
      this.buildChrome();
      this.invalidate();
    },
    captionLineCount: (): number => this.project.captions?.lines.length ?? 0,
    /** Run real Whisper transcription end-to-end (used for manual smoke). */
    transcribe: () => this.transcribe(),
    getTranscribeStatus: (): string | null => this.transcribeStatus,
    exportNow: async (): Promise<Blob> => {
      // Clear any prior result so we wait for THIS export, not a stale blob.
      this.exportDialog.lastBlob = null;
      await this.openExport();
      const startBtn = this.exportDialog.root.querySelector<HTMLButtonElement>('.btn-primary');
      startBtn?.click();
      return new Promise((resolve, reject) => {
        const check = () => {
          if (this.exportDialog.lastBlob) return resolve(this.exportDialog.lastBlob);
          const notice = this.exportDialog.root.querySelector('.export-notice');
          if (notice && !this.exportDialog.root.querySelector('.progress-track')) {
            return reject(new Error(notice.textContent ?? 'export failed'));
          }
          setTimeout(check, 250);
        };
        check();
      });
    },
  };
}

/** Per-instance placement controls: rendered by the standard schema engine. */
const PLACEMENT_SCHEMA = {
  x: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
  y: { kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.5 },
  scale: { kind: 'slider', min: 0.2, max: 2, step: 0.05, def: 1 },
} satisfies Schema;

// ---------------------------------------------------------------- fragments

function section(title: string, ...children: Array<Node | null>): HTMLElement {
  return el('section', { className: 'panel-section' },
    el('h2', { className: 'panel-title' }, title),
    ...children,
  );
}

function segmented(options: string[], value: string, onPick: (v: string) => void): HTMLElement {
  const root = el('div', { className: 'segmented', role: 'radiogroup' });
  for (const opt of options) {
    const btn = el('button', {
      className: `seg${opt === value ? ' selected' : ''}`,
      role: 'radio',
      'aria-checked': String(opt === value),
      onclick: () => {
        root.querySelectorAll('.seg').forEach((b) => {
          b.classList.remove('selected');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('selected');
        btn.setAttribute('aria-checked', 'true');
        onPick(opt);
      },
    }, opt);
    root.append(btn);
  }
  return root;
}

function svgIcon(path: string, viewBox = '0 0 24 24'): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

function playIcon(): SVGElement {
  return svgIcon('M8 5.5v13l11-6.5z');
}
function pauseIcon(): SVGElement {
  return svgIcon('M7 5h4v14H7zM13 5h4v14h-4z');
}
function loopIcon(): SVGElement {
  return svgIcon('M17 2l4 4-4 4V7H8a3 3 0 0 0-3 3v2H3v-2a5 5 0 0 1 5-5h9V2zM7 22l-4-4 4-4v3h9a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3z');
}

function brandMark(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'brand-mark');
  svg.setAttribute('aria-hidden', 'true');
  const bars = [10, 20, 14, 26, 8, 18, 12];
  bars.forEach((height, i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(3 + i * 4));
    rect.setAttribute('y', String(16 - height / 2));
    rect.setAttribute('width', '2.6');
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', '1.3');
    rect.setAttribute('fill', 'currentColor');
    svg.append(rect);
  });
  return svg;
}

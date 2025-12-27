/**
 * GentlyOS Primitive Catalog
 * All UI components in compressed format
 */

const PRIMITIVES = {
  // ═══════════════════════════════════════════════════════════════
  // LAYOUT
  // ═══════════════════════════════════════════════════════════════
  APP: {
    template: `<gentlyos-app theme="\${t}" class="\${c}">\${h}\${m}\${f}</gentlyos-app>`,
    defaults: { t: 'dark', c: '', h: '', m: '', f: '' }
  },
  GRD: {
    template: `<div class="grid cols-\${c} gap-\${g}">\${items}</div>`,
    defaults: { c: 12, g: 4, items: '' }
  },
  FLX: {
    template: `<div class="flex flex-\${d} gap-\${g}">\${items}</div>`,
    defaults: { d: 'row', g: 4, items: '' }
  },
  STK: {
    template: `<div class="stack gap-\${g}">\${items}</div>`,
    defaults: { g: 4, items: '' }
  },
  CTR: {
    template: `<div class="container max-w-\${w}">\${content}</div>`,
    defaults: { w: '7xl', content: '' }
  },

  // ═══════════════════════════════════════════════════════════════
  // CONTENT
  // ═══════════════════════════════════════════════════════════════
  TXT: {
    template: `<p class="text-\${s} text-\${c}">\${content}</p>`,
    defaults: { s: 'base', c: 'current', content: '' }
  },
  HDG: {
    template: `<h\${l} class="text-\${s} font-\${w}">\${content}</h\${l}>`,
    defaults: { l: 1, s: '4xl', w: 'bold', content: '' }
  },
  IMG: {
    template: `<img src="\${s}" alt="\${a}" class="w-\${w} h-\${h}" loading="lazy"/>`,
    defaults: { s: '', a: '', w: 'full', h: 'auto' }
  },
  VID: {
    template: `<video src="\${s}" \${autoplay} \${loop} \${muted}></video>`,
    defaults: { s: '', autoplay: '', loop: '', muted: '' }
  },
  ICO: {
    template: `<span class="icon icon-\${n} text-\${s}"></span>`,
    defaults: { n: 'star', s: 'xl' }
  },

  // ═══════════════════════════════════════════════════════════════
  // DATA DISPLAY
  // ═══════════════════════════════════════════════════════════════
  TBL: {
    template: `<table class="w-full"><thead>\${head}</thead><tbody>\${rows}</tbody></table>`,
    defaults: { head: '', rows: '' }
  },
  LST: {
    template: `<ul class="list-\${t}">\${items}</ul>`,
    defaults: { t: 'none', items: '' }
  },
  CRD: {
    template: `<div class="card bg-\${bg}"><div class="card-header">\${h}</div><div class="card-body">\${b}</div><div class="card-footer">\${f}</div></div>`,
    defaults: { bg: 'surface', h: '', b: '', f: '' }
  },
  SCR: {
    template: `<section id="\${id}" class="section-\${t}">\${content}</section>`,
    defaults: { id: '', t: 'default', content: '' }
  },

  // ═══════════════════════════════════════════════════════════════
  // FORMS
  // ═══════════════════════════════════════════════════════════════
  FRM: {
    template: `<form action="\${a}" method="\${m}" class="form-\${v}">\${fields}</form>`,
    defaults: { a: '', m: 'POST', v: 'default', fields: '' }
  },
  INP: {
    template: `<input name="\${n}" type="\${t}" placeholder="\${p}" class="input-\${v}" \${required}/>`,
    defaults: { n: '', t: 'text', p: '', v: 'default', required: '' }
  },
  TXA: {
    template: `<textarea name="\${n}" rows="\${r}" placeholder="\${p}">\${content}</textarea>`,
    defaults: { n: '', r: 4, p: '', content: '' }
  },
  SEL: {
    template: `<select name="\${n}">\${options}</select>`,
    defaults: { n: '', options: '' }
  },
  BTN: {
    template: `<button type="\${t}" class="btn btn-\${v}">\${l}</button>`,
    defaults: { t: 'button', v: 'primary', l: 'Click' }
  },
  CHK: {
    template: `<label class="checkbox"><input type="checkbox" name="\${n}" \${checked}/>\${l}</label>`,
    defaults: { n: '', l: '', checked: '' }
  },

  // ═══════════════════════════════════════════════════════════════
  // INTERACTIVE
  // ═══════════════════════════════════════════════════════════════
  MDL: {
    template: `<dialog id="\${id}" class="modal">\${content}<button class="modal-close">×</button></dialog>`,
    defaults: { id: '', content: '' }
  },
  TAB: {
    template: `<div class="tabs"><div class="tab-list">\${tabs}</div><div class="tab-panels">\${panels}</div></div>`,
    defaults: { tabs: '', panels: '' }
  },
  ACC: {
    template: `<div class="accordion">\${items}</div>`,
    defaults: { items: '' }
  },
  DRP: {
    template: `<div class="dropdown"><button class="dropdown-trigger">\${trigger}</button><div class="dropdown-content">\${content}</div></div>`,
    defaults: { trigger: '', content: '' }
  },
  TLT: {
    template: `<span class="tooltip" data-tip="\${tip}">\${content}</span>`,
    defaults: { tip: '', content: '' }
  },

  // ═══════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════
  NAV: {
    template: `<nav class="nav nav-\${v}">\${items}</nav>`,
    defaults: { v: 'default', items: '' }
  },
  LNK: {
    template: `<a href="\${h}" class="link link-\${v}">\${l}</a>`,
    defaults: { h: '#', v: 'default', l: '' }
  },
  BRD: {
    template: `<nav class="breadcrumb">\${items}</nav>`,
    defaults: { items: '' }
  },
  PAG: {
    template: `<nav class="pagination"><button class="prev">\${prev}</button><span>\${current}/\${total}</span><button class="next">\${next}</button></nav>`,
    defaults: { prev: '←', next: '→', current: 1, total: 1 }
  },

  // ═══════════════════════════════════════════════════════════════
  // FEEDBACK
  // ═══════════════════════════════════════════════════════════════
  ALT: {
    template: `<div class="alert alert-\${t}">\${content}</div>`,
    defaults: { t: 'info', content: '' }
  },
  TST: {
    template: `<div class="toast toast-\${t}">\${content}</div>`,
    defaults: { t: 'info', content: '' }
  },
  PRG: {
    template: `<div class="progress"><div class="progress-bar" style="width:\${v}%"></div></div>`,
    defaults: { v: 0 }
  },
  SPN: {
    template: `<span class="spinner spinner-\${s}"></span>`,
    defaults: { s: 'md' }
  },
  SKL: {
    template: `<div class="skeleton skeleton-\${t}" style="width:\${w};height:\${h}"></div>`,
    defaults: { t: 'text', w: '100%', h: '1em' }
  },

  // ═══════════════════════════════════════════════════════════════
  // DATA TYPES (for storage/mutations)
  // ═══════════════════════════════════════════════════════════════
  USR: {
    schema: { n: 'string', e: 'email', x: 'xor', r: 'role' },
    template: `{"name":"\${n}","email":"\${e}","xor":"\${x}","role":"\${r}"}`
  },
  PRD: {
    schema: { n: 'string', p: 'number', s: 'string', d: 'string' },
    template: `{"name":"\${n}","price":\${p},"sku":"\${s}","desc":"\${d}"}`
  },
  PST: {
    schema: { t: 'string', c: 'text', a: 'string', d: 'date' },
    template: `{"title":"\${t}","content":"\${c}","author":"\${a}","date":"\${d}"}`
  },
  GM: {
    schema: { t1: 'string', t2: 'string', s1: 'number', s2: 'number' },
    template: `{"team1":"\${t1}","team2":"\${t2}","score1":\${s1},"score2":\${s2}}`
  },
  TRX: {
    schema: { a: 'number', f: 'string', t: 'string', ts: 'timestamp' },
    template: `{"amount":\${a},"from":"\${f}","to":"\${t}","ts":\${ts}}`
  },
  EVT: {
    schema: { n: 'string', d: 'date', l: 'string', c: 'number' },
    template: `{"name":"\${n}","date":"\${d}","location":"\${l}","capacity":\${c}}`
  }
};

// ═══════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════
const THEMES = {
  'purple-green': {
    primary: '#8B5CF6',
    secondary: '#10B981',
    accent: '#06B6D4',
    bg: '#1F2937',
    surface: '#374151',
    text: '#F9FAFB'
  },
  'dark': {
    primary: '#3B82F6',
    secondary: '#6366F1',
    accent: '#8B5CF6',
    bg: '#0F172A',
    surface: '#1E293B',
    text: '#F8FAFC'
  },
  'light': {
    primary: '#2563EB',
    secondary: '#4F46E5',
    accent: '#7C3AED',
    bg: '#FFFFFF',
    surface: '#F3F4F6',
    text: '#111827'
  }
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = { PRIMITIVES, THEMES };

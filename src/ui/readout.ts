/** Tiny key/value panel. Rows are created once, only text nodes are touched per frame. */
export class Readout {
  private values = new Map<string, HTMLElement>();
  private list: HTMLElement;

  constructor(root: HTMLElement, title: string) {
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    root.append(h);
    this.list = document.createElement('div');
    this.list.className = 'rows';
    root.append(this.list);
  }

  row(key: string, label: string, hint?: string): void {
    const row = document.createElement('div');
    row.className = 'row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    if (hint) k.title = hint;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = '—';
    row.append(k, v);
    this.list.append(row);
    this.values.set(key, v);
  }

  separator(): void {
    const hr = document.createElement('div');
    hr.className = 'sep';
    this.list.append(hr);
  }

  set(key: string, value: string, tone?: 'warn' | 'hot' | 'idle'): void {
    const el = this.values.get(key);
    if (!el) return;
    if (el.textContent !== value) el.textContent = value;
    const cls = tone ? `v tone-${tone}` : 'v';
    if (el.className !== cls) el.className = cls;
  }

  /** Appends a custom element (e.g. the sector bars) to the panel body. */
  append(el: HTMLElement): void {
    this.list.append(el);
  }
}

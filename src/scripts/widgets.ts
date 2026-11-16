import type { ListName, Member, Note } from './types';
import { NOTE_COLOURS, store, uid } from './store';
import { $, avatar, cls, h } from './dom';
import { ask } from './ui';

/* Sticky notes + shopping / to-do lists (sidebar tabs) */

const memberById = (id?: string) => (id ? store.get().members.find((m) => m.id === id) : undefined);

function ago(t: number): string {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ---------- Lists ---------- */

let currentList: ListName = 'shopping';

export function renderLists(root: HTMLElement) {
  // Keep what's being typed (and the keyboard open) across re-renders
  const prev = root.querySelector<HTMLInputElement>('.add-row input');
  const prevValue = prev && root.dataset.list === currentList ? prev.value : '';
  const hadFocus = !!prev && document.activeElement === prev;
  root.dataset.list = currentList;
  const s = store.get();
  const items = s.items.filter((i) => i.list === currentList);
  const todo = items.filter((i) => !i.done).sort((a, b) => a.createdAt - b.createdAt);
  const done = items.filter((i) => i.done);

  const input = h('input', {
    class: 'input',
    placeholder: currentList === 'shopping' ? 'Add to shopping… (e.g. milk)' : 'Add a job… (e.g. empty the dishwasher)',
    enterkeyhint: 'done',
    maxlength: '80',
    autocomplete: 'off',
  });
  const who = h(
    'select',
    { class: 'input who-select', 'aria-label': 'For' },
    h('option', { value: '' }, 'Anyone'),
    ...s.members.map((m) => h('option', { value: m.id }, m.name)),
  );
  const add = () => {
    const parts = input.value
      .split(/,|\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;
    input.value = ''; // clear before the store update re-renders (the new box copies this value)
    refocus = true;
    store.update((st) =>
      parts.forEach((text) =>
        st.items.push({ id: uid(), list: currentList, text, done: false, memberId: who.value || undefined, createdAt: Date.now() }),
      ),
    );
  };
  let refocus = false;
  input.value = prevValue;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      add();
      // the store update re-renders synchronously; put the cursor back in the new box
      if (refocus) root.querySelector<HTMLInputElement>('.add-row input')?.focus();
    }
  });

  const row = (i: (typeof items)[number]) => {
    const m = memberById(i.memberId);
    return h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: cls('list-item', i.done && 'done'),
          onclick: () =>
            store.update((st) => {
              const x = st.items.find((y) => y.id === i.id);
              if (x) x.done = !x.done;
            }),
        },
        h('span', { class: 'tick' }, i.done ? '✓' : ''),
        h('span', { class: 'text' }, i.text),
        m ? avatar(m, 28) : null,
      ),
    );
  };

  root.replaceChildren(
    h(
      'div',
      { class: 'seg' },
      ...(['shopping', 'todo'] as ListName[]).map((l) => {
        const n = s.items.filter((i) => i.list === l && !i.done).length;
        return h(
          'button',
          {
            type: 'button',
            class: cls(currentList === l && 'on'),
            onclick: () => {
              currentList = l;
              renderLists(root);
            },
          },
          l === 'shopping' ? '🛒 Shopping' : '✅ To-do',
          n ? h('span', { class: 'badge' }, String(n)) : null,
        );
      }),
    ),
    h('div', { class: 'add-row' }, input, currentList === 'todo' ? who : null, h('button', { type: 'button', class: 'btn primary', onclick: () => (add(), root.querySelector<HTMLInputElement>('.add-row input')?.focus()) }, 'Add')),
    h(
      'ul',
      { class: 'list' },
      ...todo.map(row),
      ...done.map(row),
      !items.length && h('li', { class: 'empty small' }, currentList === 'shopping' ? 'Nothing on the shopping list.' : 'No jobs — nice!'),
    ),
    ...(done.length > 0
      ? [
          h(
        'button',
        {
          type: 'button',
          class: 'btn ghost small clear-done',
          onclick: () =>
            store.update((st) => {
              st.items = st.items.filter((i) => !(i.list === currentList && i.done));
            }),
        },
        `Clear ${done.length} ticked`,
          ),
        ]
      : []),
  );
  if (hadFocus) input.focus();
}

/* ---------- Notes ---------- */

export function noteCard(n: Note, onClick?: () => void, size: 'normal' | 'big' = 'normal') {
  const m = memberById(n.memberId);
  return h(
    'button',
    { type: 'button', class: cls('note', size === 'big' && 'big'), style: `--n:${n.color}`, onclick: onClick ?? null },
    h('div', { class: 'note-text' }, n.text),
    h('div', { class: 'note-foot' }, m ? avatar(m, 26) : null, h('span', {}, m ? `For ${m.name}` : 'Everyone'), h('span', { class: 'note-age' }, ago(n.createdAt))),
  );
}

export function renderNotes(root: HTMLElement) {
  const notes = [...store.get().notes].sort((a, b) => b.createdAt - a.createdAt);
  root.replaceChildren(
    h('div', { class: 'notes-head' }, h('button', { type: 'button', class: 'btn primary', onclick: () => openNote() }, '+ New note')),
    notes.length
      ? h('div', { class: 'notes-grid' }, ...notes.map((n) => noteCard(n, () => openNote(n))))
      : h('p', { class: 'empty small' }, 'Leave a note for the family — "Defrost the chicken", "Dog walked ✔".'),
  );
}

let editingNote: Note | null = null;
let noteColour = NOTE_COLOURS[0];
let noteFor: string | undefined;

function renderNoteOptions(members: Member[]) {
  $('#note-colours').replaceChildren(
    ...NOTE_COLOURS.map((c) =>
      h('button', {
        type: 'button',
        class: cls('swatch', c === noteColour && 'on'),
        style: `--c:${c}`,
        'aria-label': 'Note colour',
        onclick: () => {
          noteColour = c;
          renderNoteOptions(members);
        },
      }),
    ),
  );
  $('#note-for').replaceChildren(
    h('button', { type: 'button', class: cls('chip', !noteFor && 'on'), style: '--c:#9ba1ad', onclick: () => ((noteFor = undefined), renderNoteOptions(members)) }, h('span', {}, 'Everyone')),
    ...members.map((m) =>
      h(
        'button',
        { type: 'button', class: cls('chip', noteFor === m.id && 'on'), style: `--c:${m.color}`, onclick: () => ((noteFor = m.id), renderNoteOptions(members)) },
        avatar(m, 28),
        h('span', {}, m.name),
      ),
    ),
  );
}

export function openNote(n?: Note) {
  editingNote = n ?? null;
  noteColour = n?.color ?? NOTE_COLOURS[0];
  noteFor = n?.memberId;
  $<HTMLTextAreaElement>('#note-text').value = n?.text ?? '';
  $('#note-delete').hidden = !n;
  $('#note-dialog-title').textContent = n ? 'Edit note' : 'New note';
  renderNoteOptions(store.get().members);
  $<HTMLDialogElement>('#note-dialog').showModal();
  setTimeout(() => $<HTMLTextAreaElement>('#note-text').focus(), 50);
}

export function initNotes() {
  $('#note-save').addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('#note-text').value.trim();
    if (!text) return;
    store.update((s) => {
      if (editingNote) {
        const x = s.notes.find((y) => y.id === editingNote!.id);
        if (x) Object.assign(x, { text, color: noteColour, memberId: noteFor });
      } else {
        s.notes.push({ id: uid(), text, color: noteColour, memberId: noteFor, createdAt: Date.now() });
      }
    });
    $<HTMLDialogElement>('#note-dialog').close();
  });
  $('#note-delete').addEventListener('click', async () => {
    if (!editingNote || !(await ask('Remove this note?', 'Remove'))) return;
    const id = editingNote.id;
    store.update((s) => {
      s.notes = s.notes.filter((x) => x.id !== id);
    });
    $<HTMLDialogElement>('#note-dialog').close();
  });
}

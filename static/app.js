let displayTheme = 'day';
try { displayTheme = localStorage.getItem('my-space-theme') === 'night' ? 'night' : 'day'; } catch { /* Default to day. */ }
function applyTheme(theme) {
  displayTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-icon').textContent = theme === 'night' ? '☀' : '☾';
  document.getElementById('theme-label').textContent = theme === 'night' ? 'Day' : 'Night';
  document.getElementById('theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'night' ? 'day' : 'night'} mode`);
  document.getElementById('theme-toggle').setAttribute('aria-pressed', String(theme === 'night'));
  document.querySelector('meta[name="theme-color"]').content = theme === 'night' ? '#191b22' : '#f4efe9';
  try { localStorage.setItem('my-space-theme', theme); } catch { /* Keep this session's preference. */ }
}
applyTheme(displayTheme);
document.getElementById('theme-toggle').addEventListener('click', () => {
  applyTheme(displayTheme === 'day' ? 'night' : 'day');
  scheduleSharedSave('theme');
});

const backgrounds = {
  sunrise: 'radial-gradient(circle at 12% 18%, #f5d9cc 0, transparent 34%), radial-gradient(circle at 83% 75%, #d9d6ed 0, transparent 38%), #f4efe9',
  lilac: 'linear-gradient(135deg, #dcd0ed, #f5e1e8 60%, #f8f0e9)',
  sky: 'linear-gradient(135deg, #bedee9, #e4f2ef 60%, #f7f0df)',
  sage: 'linear-gradient(135deg, #d1deca, #e8e8cf 60%, #f6e7d5)'
};

const starterSpaces = [
  { id: 'notes', title: 'Notes', icon: 'notes', color: '#f9e8df' },
  { id: 'moments', title: 'Moments', icon: 'moments', color: '#e9e5f6' },
  { id: 'projects', title: 'Projects', icon: 'projects', color: '#dfece8' },
  { id: 'collection', title: 'Collection', icon: 'collection', color: '#f7e9d8' },
  { id: 'space-mv6d516l-yqzp9', title: 'Study at ETH', icon: 'notes', color: '#e7e9f6' }
];
const allowedIcons = new Set(['notes', 'moments', 'projects', 'collection', 'star', 'music', 'leaf', 'coffee']);
const tileColors = ['#f9e8df', '#e9e5f6', '#dfece8', '#f7e9d8', '#e7e9f6', '#f3dfdf', '#e2edda', '#e8e3f2'];
const isEthSpace = space => space.id === 'space-mv6d516l-yqzp9' || space.title.trim().toLowerCase() === 'study at eth';
const isValidSpace = space => typeof space?.id === 'string' && /^[a-z0-9-]+$/.test(space.id) && typeof space.title === 'string' && space.title.trim().length <= 28 && allowedIcons.has(space.icon) && /^#[0-9a-f]{6}$/i.test(space.color);
let spaces = loadSpaces();
let trashedSpaces = loadTrash();
let homeTodos = loadHomeTodos();
let sharedStateReady = false;
let sharedRevision = 0;
let sharedSaveChain = Promise.resolve();

function loadSpaces() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-space-spaces-v1'));
    if (Array.isArray(saved)) {
      const valid = saved.filter(isValidSpace);
      return valid;
    }
  } catch { /* Use starter spaces. */ }
  return starterSpaces.map(space => ({ ...space }));
}

function saveSpaces() {
  try { localStorage.setItem('my-space-spaces-v1', JSON.stringify(spaces)); scheduleSharedSave('spaces'); return true; }
  catch { return false; }
}

function loadTrash() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-space-trash-v1'));
    if (Array.isArray(saved)) return saved.filter(item => isValidSpace(item?.space) && Number.isInteger(item.originalIndex) && item.originalIndex >= 0);
  } catch { /* Start with an empty Trash. */ }
  return [];
}

function validHomeTodo(item) {
  return item && typeof item.id === 'string' && /^[a-z0-9-]{1,64}$/i.test(item.id) &&
    typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 120 &&
    typeof item.done === 'boolean';
}

function loadHomeTodos() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-space-home-todos-v1'));
    return Array.isArray(saved) ? saved.filter(validHomeTodo).slice(0, 500) : [];
  } catch { return []; }
}

function saveHomeTodos() {
  try {
    localStorage.setItem('my-space-home-todos-v1', JSON.stringify(homeTodos));
    scheduleSharedSave('homeTodos');
    return true;
  } catch { return false; }
}

function renderHomeTodos() {
  const list = document.getElementById('home-todo-list');
  const remaining = homeTodos.filter(item => !item.done).length;
  document.getElementById('home-todo-count').textContent = remaining ? `${remaining} left` : homeTodos.length ? 'All done' : '';
  if (!homeTodos.length) {
    const empty = document.createElement('li');
    empty.className = 'home-todo-empty';
    empty.textContent = 'Nothing on your list yet.';
    list.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  homeTodos.forEach(item => {
    const row = document.createElement('li');
    row.classList.toggle('is-done', item.done);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.setAttribute('aria-label', `${item.done ? 'Mark as not done' : 'Complete'}: ${item.title}`);
    checkbox.addEventListener('change', () => {
      homeTodos = homeTodos.map(todo => todo.id === item.id ? { ...todo, done: checkbox.checked } : todo);
      saveHomeTodos();
      renderHomeTodos();
    });
    const title = document.createElement('span');
    title.className = 'home-todo-text';
    title.textContent = item.title;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'home-todo-delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${item.title}`);
    remove.addEventListener('click', () => {
      homeTodos = homeTodos.filter(todo => todo.id !== item.id);
      saveHomeTodos();
      renderHomeTodos();
    });
    row.append(checkbox, title, remove);
    fragment.append(row);
  });
  list.replaceChildren(fragment);
}

document.getElementById('home-todo-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('home-todo-input');
  const title = input.value.trim();
  if (!title || homeTodos.length >= 500) return;
  homeTodos = [...homeTodos, { id: crypto.randomUUID(), title, done: false }];
  if (!saveHomeTodos()) homeTodos.pop();
  renderHomeTodos();
  input.value = '';
  input.focus();
});

function saveTrash() {
  try { localStorage.setItem('my-space-trash-v1', JSON.stringify(trashedSpaces)); scheduleSharedSave('trash'); return true; }
  catch { return false; }
}

const backdrop = document.getElementById('backdrop');
const customizer = document.getElementById('customizer');
const overlay = document.getElementById('panel-overlay');
const status = document.getElementById('panel-status');
const presets = [...document.querySelectorAll('[data-preset]')];
const colorInput = document.getElementById('background-color');
const uploadInput = document.getElementById('background-upload');
const removePhoto = document.getElementById('remove-photo');
let previousFocus = null;
let imageUrl = null;
let currentBackgroundChoice = { type: 'preset', value: 'sunrise' };

function releaseBackgroundUrl() {
  if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
}

function saveChoice(choice) {
  try { localStorage.setItem('my-space-background', JSON.stringify(choice)); currentBackgroundChoice = choice; scheduleSharedSave('background'); }
  catch { status.textContent = 'This browser could not save your choice.'; }
}

function applyChoice(choice) {
  document.documentElement.dataset.background = choice.type;
  presets.forEach(button => button.setAttribute('aria-pressed', String(choice.type === 'preset' && button.dataset.preset === choice.value)));
  removePhoto.hidden = choice.type !== 'image';
  if (choice.type === 'preset') backdrop.style.background = backgrounds[choice.value] || backgrounds.sunrise;
  if (choice.type === 'color') { backdrop.style.background = choice.value; colorInput.value = choice.value; }
  if (choice.type === 'image' && imageUrl) backdrop.style.background = `url("${imageUrl}") center / cover no-repeat`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('Unavailable'));
    const request = indexedDB.open('my-space', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function imageStore(action, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', action === 'read' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('settings');
    const request = action === 'read' ? store.get('background-image') : action === 'delete' ? store.delete('background-image') : store.put(value, 'background-image');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function loadChoice() {
  let choice;
  try { choice = JSON.parse(localStorage.getItem('my-space-background')); } catch { /* Use default. */ }
  if (!choice || !['preset', 'color', 'image'].includes(choice.type)) choice = { type: 'preset', value: 'sunrise' };
  if (choice.type === 'image') {
    try {
      const blob = await imageStore('read');
      if (blob) imageUrl = URL.createObjectURL(blob);
      else choice = { type: 'preset', value: 'sunrise' };
    } catch { choice = { type: 'preset', value: 'sunrise' }; }
  }
  currentBackgroundChoice = choice;
  applyChoice(choice);
}

function setPanel(open) {
  customizer.hidden = !open;
  overlay.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) { previousFocus = document.activeElement; document.getElementById('close-customizer').focus(); }
  else previousFocus?.focus();
}

document.getElementById('open-customizer').addEventListener('click', () => setPanel(true));
document.getElementById('close-customizer').addEventListener('click', () => setPanel(false));
overlay.addEventListener('click', () => setPanel(false));
document.addEventListener('keydown', event => {
  if (customizer.hidden) return;
  if (event.key === 'Escape') setPanel(false);
  if (event.key === 'Tab') {
    const focusable = [...customizer.querySelectorAll('button:not([hidden]), input:not([hidden]), [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

presets.forEach(button => button.addEventListener('click', () => {
  const choice = { type: 'preset', value: button.dataset.preset };
  applyChoice(choice); saveChoice(choice); status.textContent = `${button.textContent.trim()} background selected.`;
}));
colorInput.addEventListener('input', () => {
  const choice = { type: 'color', value: colorInput.value };
  applyChoice(choice); saveChoice(choice); status.textContent = 'Custom color selected.';
});
document.querySelector('.upload-control').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    uploadInput.click();
  }
});
uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { status.textContent = 'Please choose a JPG, PNG, or WebP image.'; return; }
  releaseBackgroundUrl();
  imageUrl = URL.createObjectURL(file);
  const choice = { type: 'image' };
  applyChoice(choice);
  try {
    await imageStore('write', file);
    if (sharedStateReady) {
      const response = await fetch('/api/background-image', { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Could not save the shared photo.');
    }
    saveChoice(choice);
    status.textContent = sharedStateReady ? 'Your photo is shared across browsers.' : 'Your photo is saved on this device.';
  }
  catch { status.textContent = 'Your photo is visible now, but this browser could not save it.'; }
  uploadInput.value = '';
});
removePhoto.addEventListener('click', async () => {
  try { await imageStore('delete'); } catch { /* Continue with the default scene. */ }
  if (sharedStateReady) {
    try { await fetch('/api/background-image', { method: 'DELETE' }); } catch { /* The saved scene can still change. */ }
  }
  releaseBackgroundUrl();
  imageUrl = null;
  const choice = { type: 'preset', value: 'sunrise' };
  applyChoice(choice); saveChoice(choice); status.textContent = 'Photo removed.';
});

const spaceGrid = document.getElementById('space-grid');
const spaceDialog = document.getElementById('space-dialog');
const addSpaceForm = document.getElementById('add-space-form');
const dialogStatus = document.getElementById('dialog-status');
const renameDialog = document.getElementById('rename-space-dialog');
const renameForm = document.getElementById('rename-space-form');
const editSpacesButton = document.getElementById('edit-spaces');
const deleteSpaceDialog = document.getElementById('delete-space-dialog');
const trashDialog = document.getElementById('trash-dialog');
const permanentDeleteDialog = document.getElementById('permanent-delete-dialog');
const trashDropZone = document.getElementById('trash-drop-zone');
const newPictureInput = document.getElementById('new-space-picture');
const editPictureInput = document.getElementById('edit-space-picture');
const createSpaceSubmit = document.getElementById('create-space-submit');
const saveSpaceSubmit = document.getElementById('save-space-submit');
let newSpaceImage = null;
let editSpaceImage = null;
let newPictureVersion = 0;
let editPictureVersion = 0;
let editingSpaces = false;
let pendingDeleteId = null;
let pendingRenameId = null;
let pendingPermanentDeleteId = null;
let dragContext = null;
let suppressSpaceClickUntil = 0;

function showPicturePreview(previewId, image) {
  const preview = document.getElementById(previewId);
  preview.hidden = !image;
  preview.querySelector('img').src = image || '';
}

function resizeSpacePicture(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choose a JPG, PNG, or WebP picture.'));
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('Choose a picture smaller than 10 MB.'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const context = canvas.getContext('2d');
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
        const webp = canvas.toDataURL('image/webp', 0.82);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
      } catch { reject(new Error('This picture could not be processed.')); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture could not be opened.')); };
    image.src = url;
  });
}

function setSpaceIcon(container, space) {
  if (space.image) {
    const image = document.createElement('img');
    image.className = 'space-image';
    image.alt = '';
    image.src = space.image;
    container.replaceChildren(image);
  } else {
    container.innerHTML = `<svg aria-hidden="true"><use href="#icon-${space.icon}" /></svg>`;
  }
}

function commitSpaceChange(nextSpaces, nextTrash) {
  const previousSpaces = spaces;
  const previousTrash = trashedSpaces;
  spaces = nextSpaces;
  trashedSpaces = nextTrash;
  if (!saveSpaces() || !saveTrash()) {
    spaces = previousSpaces;
    trashedSpaces = previousTrash;
    saveSpaces();
    saveTrash();
    window.alert('This browser could not save the change.');
    return false;
  }
  renderTiles();
  renderTrash();
  return true;
}

function moveSpaceToTrash(id) {
  const index = spaces.findIndex(space => space.id === id);
  if (index < 0) return false;
  const entry = { space: spaces[index], originalIndex: index };
  const saved = commitSpaceChange(spaces.filter(space => space.id !== id), [entry, ...trashedSpaces.filter(item => item.space.id !== id)]);
  if (saved && location.hash === `#${id}`) location.hash = '#home';
  return saved;
}

function renderTrash() {
  const count = trashedSpaces.length;
  document.getElementById('trash-count').textContent = count ? String(count) : '';
  const container = document.getElementById('trash-items');
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'trash-empty';
    empty.textContent = 'Trash is empty.';
    container.replaceChildren(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'trash-list';
  trashedSpaces.forEach(entry => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = entry.space.title;
    const actions = document.createElement('div');
    actions.className = 'trash-item-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore';
    restore.setAttribute('aria-label', `Restore ${entry.space.title}`);
    restore.addEventListener('click', () => {
      const nextSpaces = [...spaces];
      nextSpaces.splice(Math.min(entry.originalIndex, nextSpaces.length), 0, entry.space);
      if (commitSpaceChange(nextSpaces, trashedSpaces.filter(item => item.space.id !== entry.space.id))) document.getElementById('close-trash').focus();
    });
    const deleteForever = document.createElement('button');
    deleteForever.type = 'button';
    deleteForever.className = 'delete-forever-button';
    deleteForever.textContent = 'Delete forever';
    deleteForever.setAttribute('aria-label', `Delete ${entry.space.title} forever`);
    deleteForever.addEventListener('click', () => {
      pendingPermanentDeleteId = entry.space.id;
      const removesProgress = isEthSpace(entry.space) && !spaces.some(isEthSpace) && !trashedSpaces.some(item => item.space.id !== entry.space.id && isEthSpace(item.space));
      document.getElementById('permanent-delete-message').textContent = `Permanently delete “${entry.space.title}”?${removesProgress ? ' Its saved assignment progress will also be removed.' : ''} This cannot be undone.`;
      permanentDeleteDialog.showModal();
      document.getElementById('cancel-permanent-delete').focus();
    });
    actions.append(restore, deleteForever);
    item.append(name, actions);
    list.append(item);
  });
  container.replaceChildren(list);
}

function renderTiles() {
  const fragment = document.createDocumentFragment();
  spaceGrid.classList.toggle('is-editing', editingSpaces);
  spaceGrid.classList.toggle('is-aligned', spaces.every(space => !Number.isFinite(space.position?.x) || !Number.isFinite(space.position?.y)));
  spaces.forEach(space => {
    const wrapper = document.createElement('div');
    wrapper.className = 'space-tile';
    wrapper.dataset.spaceId = space.id;
    if (Number.isFinite(space.position?.x) && Number.isFinite(space.position?.y)) {
      wrapper.classList.add('is-placed');
      wrapper.style.setProperty('--space-x', `${Math.max(0, Math.min(100, space.position.x))}%`);
      wrapper.style.setProperty('--space-y', `${Math.max(0, Math.min(100, space.position.y))}%`);
    }
    wrapper.addEventListener('pointerdown', startSpaceDrag);
    const tile = document.createElement(editingSpaces ? 'div' : 'a');
    tile.className = 'space-card';
    if (!editingSpaces) tile.href = `#${space.id}`;
    tile.draggable = false;
    tile.style.setProperty('--tile-color', space.color);
    tile.innerHTML = '<span class="card-icon"></span><span class="space-name"></span>';
    setSpaceIcon(tile.querySelector('.card-icon'), space);
    const name = tile.querySelector('.space-name');
    for (const part of space.title.split(/([_-])/)) {
      name.append(document.createTextNode(part));
      if (part === '_' || part === '-') name.append(document.createElement('wbr'));
    }
    tile.title = space.title;
    wrapper.append(tile);
    if (editingSpaces) {
      const renameButton = document.createElement('button');
      renameButton.className = 'rename-space-button';
      renameButton.type = 'button';
      renameButton.setAttribute('aria-label', `Edit ${space.title}`);
      renameButton.title = `Edit ${space.title}`;
      renameButton.textContent = '✎';
      renameButton.addEventListener('click', () => {
        pendingRenameId = space.id;
        editPictureVersion++;
        editSpaceImage = space.image || null;
        editPictureInput.value = '';
        showPicturePreview('edit-picture-preview', editSpaceImage);
        document.getElementById('rename-space-name').value = space.title;
        document.getElementById('rename-space-status').textContent = '';
        renameDialog.showModal();
        document.getElementById('rename-space-name').select();
      });
      wrapper.append(renameButton);
      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-space-button';
      deleteButton.type = 'button';
      deleteButton.setAttribute('aria-label', `Move ${space.title} to Trash`);
      deleteButton.title = `Move ${space.title} to Trash`;
      deleteButton.textContent = '×';
      deleteButton.addEventListener('click', () => {
        pendingDeleteId = space.id;
        document.getElementById('delete-space-message').textContent = `Move “${space.title}” to Trash? You can restore it later.`;
        deleteSpaceDialog.showModal();
        document.getElementById('cancel-delete-space').focus();
      });
      wrapper.append(deleteButton);
    }
    fragment.append(wrapper);
  });

  spaceGrid.replaceChildren(fragment);
}

document.getElementById('open-add-space').addEventListener('click', () => {
  newSpaceImage = null;
  newPictureInput.value = '';
  showPicturePreview('new-picture-preview', null);
  dialogStatus.textContent = '';
  spaceDialog.showModal();
  document.getElementById('new-space-name').focus();
});

document.getElementById('align-spaces').addEventListener('click', () => {
  const previousSpaces = spaces;
  spaces = spaces.map(({ position, ...space }) => space);
  if (!saveSpaces()) {
    spaces = previousSpaces;
    window.alert('This browser could not save the alignment.');
  }
  renderTiles();
});

function startSpaceDrag(event) {
  if (event.button !== 0 || event.target.closest('.delete-space-button,.rename-space-button')) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  dragContext = { pointerId: event.pointerId, source: event.currentTarget, originalSpaces: spaces, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, active: false, ghost: null, slotRects: null, slotPositions: null, previewTarget: null };
}

function freezeSpacePositions() {
  const bounds = spaceGrid.getBoundingClientRect();
  const tiles = [...spaceGrid.querySelectorAll('.space-tile')];
  const positions = new Map(tiles.map(tile => {
    const rect = tile.getBoundingClientRect();
    return [tile.dataset.spaceId, {
      x: Math.max(0, Math.min(100, (rect.left - bounds.left) / bounds.width * 100)),
      y: Math.max(0, Math.min(100, (rect.top - bounds.top) / bounds.height * 100))
    }];
  }));
  spaces = spaces.map(space => ({ ...space, position: positions.get(space.id) }));
  tiles.forEach(tile => {
    const position = positions.get(tile.dataset.spaceId);
    tile.style.setProperty('--space-x', `${position.x}%`);
    tile.style.setProperty('--space-y', `${position.y}%`);
    tile.classList.add('is-placed');
  });
  spaceGrid.classList.remove('is-aligned');
  return positions;
}

function swapTargetForDrag(drag) {
  const moving = drag.ghost.getBoundingClientRect();
  let best = null;
  let largestOverlap = 0;
  for (const tile of spaceGrid.querySelectorAll('.space-tile')) {
    if (tile === drag.source) continue;
    const target = drag.slotRects.get(tile.dataset.spaceId);
    const width = Math.max(0, Math.min(moving.right, target.right) - Math.max(moving.left, target.left));
    const height = Math.max(0, Math.min(moving.bottom, target.bottom) - Math.max(moving.top, target.top));
    const overlap = width * height;
    if (overlap > largestOverlap) { best = tile; largestOverlap = overlap; }
  }
  return largestOverlap > 0 ? best : null;
}

function updateSwapPreview(drag, target) {
  if (drag.previewTarget === target) return;
  if (drag.previewTarget) {
    const previousPosition = drag.slotPositions.get(drag.previewTarget.dataset.spaceId);
    drag.previewTarget.style.setProperty('--space-x', `${previousPosition.x}%`);
    drag.previewTarget.style.setProperty('--space-y', `${previousPosition.y}%`);
    drag.previewTarget.classList.remove('is-swap-target');
  }
  drag.previewTarget = target;
  drag.source.classList.toggle('has-swap-preview', Boolean(target));
  drag.ghost.classList.toggle('is-swapping', Boolean(target));
  if (target) {
    const sourcePosition = drag.slotPositions.get(drag.source.dataset.spaceId);
    target.style.setProperty('--space-x', `${sourcePosition.x}%`);
    target.style.setProperty('--space-y', `${sourcePosition.y}%`);
    target.classList.add('is-swap-target');
  }
}

document.addEventListener('pointermove', event => {
  const drag = dragContext;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8) return;
  if (!drag.active) {
    drag.active = true;
    drag.slotPositions = freezeSpacePositions();
    drag.slotRects = new Map([...spaceGrid.querySelectorAll('.space-tile')].map(tile => [tile.dataset.spaceId, tile.getBoundingClientRect()]));
    spaceGrid.classList.add('is-dragging');
    drag.source.classList.add('is-dragging');
    drag.ghost = drag.source.querySelector('.space-card').cloneNode(true);
    drag.ghost.classList.add('space-drag-ghost');
    document.body.append(drag.ghost);
    trashDropZone.hidden = false;
  }
  event.preventDefault();
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const overTrash = hit && trashDropZone.contains(hit);
  trashDropZone.classList.toggle('is-over', Boolean(overTrash));
  const swapTarget = overTrash ? null : swapTargetForDrag(drag);
  updateSwapPreview(drag, swapTarget);
});

function finishSpaceDrag(event) {
  const drag = dragContext;
  if (!drag || drag.pointerId !== event.pointerId) return;
  dragContext = null;
  if (!drag.active) return;
  suppressSpaceClickUntil = Date.now() + 500;
  const overTrash = event.type === 'pointerup' && trashDropZone.contains(document.elementFromPoint(event.clientX, event.clientY));
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
  const swapTarget = event.type === 'pointerup' && !overTrash ? drag.previewTarget || swapTargetForDrag(drag) : null;
  drag.ghost.remove();
  drag.source.classList.remove('is-dragging');
  spaceGrid.classList.remove('is-dragging');
  trashDropZone.hidden = true;
  trashDropZone.classList.remove('is-over');
  if (event.type === 'pointercancel') { spaces = drag.originalSpaces; renderTiles(); return; }
  if (overTrash) {
    if (!moveSpaceToTrash(drag.source.dataset.spaceId)) { spaces = drag.originalSpaces; renderTiles(); }
    return;
  }
  if (swapTarget) {
    const sourceId = drag.source.dataset.spaceId;
    const targetId = swapTarget.dataset.spaceId;
    const sourcePosition = drag.slotPositions.get(sourceId);
    const targetPosition = drag.slotPositions.get(targetId);
    spaces = spaces.map(space => space.id === sourceId ? { ...space, position: targetPosition } : space.id === targetId ? { ...space, position: sourcePosition } : space);
    if (!saveSpaces()) {
      spaces = drag.originalSpaces;
      window.alert('This browser could not save the swap.');
    }
    renderTiles();
    return;
  }
  const bounds = spaceGrid.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (event.clientX - bounds.left - drag.offsetX) / bounds.width * 100));
  const y = Math.max(0, Math.min(100, (event.clientY - bounds.top - drag.offsetY) / bounds.height * 100));
  spaces = spaces.map(space => space.id === drag.source.dataset.spaceId ? { ...space, position: { x, y } } : space);
  if (!saveSpaces()) {
    spaces = drag.originalSpaces;
    window.alert('This browser could not save the new position.');
  }
  renderTiles();
}

document.addEventListener('pointerup', finishSpaceDrag);
document.addEventListener('pointercancel', finishSpaceDrag);
spaceGrid.addEventListener('click', event => {
  if (Date.now() < suppressSpaceClickUntil && event.target.closest('.space-card')) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

editSpacesButton.addEventListener('click', () => {
  editingSpaces = !editingSpaces;
  editSpacesButton.textContent = editingSpaces ? 'Done' : 'Edit';
  editSpacesButton.setAttribute('aria-pressed', String(editingSpaces));
  renderTiles();
});

newPictureInput.addEventListener('change', async () => {
  const file = newPictureInput.files?.[0];
  if (!file) return;
  const version = ++newPictureVersion;
  createSpaceSubmit.disabled = true;
  dialogStatus.textContent = '';
  try {
    const image = await resizeSpacePicture(file);
    if (version === newPictureVersion) {
      newSpaceImage = image;
      showPicturePreview('new-picture-preview', image);
    }
  } catch (error) { if (version === newPictureVersion) dialogStatus.textContent = error.message; }
  finally { if (version === newPictureVersion) createSpaceSubmit.disabled = false; newPictureInput.value = ''; }
});
document.getElementById('remove-new-picture').addEventListener('click', () => {
  newPictureVersion++;
  newSpaceImage = null;
  createSpaceSubmit.disabled = false;
  showPicturePreview('new-picture-preview', null);
});
editPictureInput.addEventListener('change', async () => {
  const file = editPictureInput.files?.[0];
  if (!file) return;
  const version = ++editPictureVersion;
  saveSpaceSubmit.disabled = true;
  document.getElementById('rename-space-status').textContent = '';
  try {
    const image = await resizeSpacePicture(file);
    if (version === editPictureVersion) {
      editSpaceImage = image;
      showPicturePreview('edit-picture-preview', image);
    }
  } catch (error) { if (version === editPictureVersion) document.getElementById('rename-space-status').textContent = error.message; }
  finally { if (version === editPictureVersion) saveSpaceSubmit.disabled = false; editPictureInput.value = ''; }
});
document.getElementById('remove-edit-picture').addEventListener('click', () => {
  editPictureVersion++;
  editSpaceImage = null;
  saveSpaceSubmit.disabled = false;
  showPicturePreview('edit-picture-preview', null);
});

document.getElementById('cancel-rename-space').addEventListener('click', () => renameDialog.close());
renameDialog.addEventListener('close', () => { editPictureVersion++; saveSpaceSubmit.disabled = false; pendingRenameId = null; editSpacesButton.focus(); });
renameForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = document.getElementById('rename-space-name').value.trim();
  if (!title) { document.getElementById('rename-space-status').textContent = 'Please enter a name.'; return; }
  const previousSpaces = spaces;
  spaces = spaces.map(space => space.id === pendingRenameId ? { ...space, title, image: editSpaceImage } : space);
  if (!saveSpaces()) {
    spaces = previousSpaces;
    document.getElementById('rename-space-status').textContent = 'This browser could not save these changes.';
    return;
  }
  renderTiles();
  if (location.hash === `#${pendingRenameId}`) renderRoute();
  renameDialog.close();
});

document.getElementById('cancel-delete-space').addEventListener('click', () => deleteSpaceDialog.close());
deleteSpaceDialog.addEventListener('close', () => { pendingDeleteId = null; editSpacesButton.focus(); });
document.getElementById('confirm-delete-space').addEventListener('click', () => {
  if (!pendingDeleteId) return;
  if (moveSpaceToTrash(pendingDeleteId)) deleteSpaceDialog.close();
});

document.getElementById('open-trash').addEventListener('click', () => {
  renderTrash();
  trashDialog.showModal();
  document.getElementById('close-trash').focus();
});
document.getElementById('close-trash').addEventListener('click', () => trashDialog.close());
trashDialog.addEventListener('click', event => { if (event.target === trashDialog) trashDialog.close(); });

document.getElementById('cancel-permanent-delete').addEventListener('click', () => permanentDeleteDialog.close());
permanentDeleteDialog.addEventListener('close', () => {
  pendingPermanentDeleteId = null;
  if (trashDialog.open) document.getElementById('close-trash').focus();
});
document.getElementById('confirm-permanent-delete').addEventListener('click', () => {
  const entry = trashedSpaces.find(item => item.space.id === pendingPermanentDeleteId);
  if (!entry) return;
  const previousTrash = trashedSpaces;
  const nextTrash = trashedSpaces.filter(item => item.space.id !== entry.space.id);
  const clearProgress = isEthSpace(entry.space) && !spaces.some(isEthSpace) && !nextTrash.some(item => isEthSpace(item.space));
  trashedSpaces = nextTrash;
  if (!saveTrash()) {
    trashedSpaces = previousTrash;
    window.alert('This browser could not permanently delete the space.');
    return;
  }
  if (clearProgress) {
    try {
      localStorage.removeItem('my-space-eth-progress-v1');
      progress = {};
      scheduleSharedSave('progress');
    } catch {
      trashedSpaces = previousTrash;
      saveTrash();
      window.alert('This browser could not remove the saved assignment progress.');
      return;
    }
  }
  renderTrash();
  permanentDeleteDialog.close();
});

document.getElementById('close-space-dialog').addEventListener('click', () => spaceDialog.close());
spaceDialog.addEventListener('click', event => { if (event.target === spaceDialog) spaceDialog.close(); });
spaceDialog.addEventListener('close', () => { newPictureVersion++; createSpaceSubmit.disabled = false; });
addSpaceForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = document.getElementById('new-space-name').value.trim();
  if (!title) { dialogStatus.textContent = 'Please give your space a name.'; return; }
  const icon = addSpaceForm.elements.icon.value;
  if (!allowedIcons.has(icon)) return;
  const space = {
    id: `space-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    icon,
    color: tileColors[spaces.length % tileColors.length],
    image: newSpaceImage
  };
  spaces.push(space);
  const saved = saveSpaces();
  renderTiles();
  addSpaceForm.reset();
  newSpaceImage = null;
  showPicturePreview('new-picture-preview', null);
  spaceDialog.close();
  if (!saved) window.alert('Space added for now, but this browser could not save it.');
  [...spaceGrid.querySelectorAll('.space-tile')].find(tile => tile.dataset.spaceId === space.id)?.querySelector('.space-card')?.focus();
});

const assignmentList = document.getElementById('assignment-list');
const calendarGrid = document.getElementById('calendar-grid');
const studyStatus = document.getElementById('study-status');
const refreshAssignmentsButton = document.getElementById('refresh-assignments');
let assignments = [];
let assignmentsLoaded = false;
let studyCourses = loadStudyCourses();
let studyTasks = loadStudyTasks();
let studySection = 'overview';
let selectedCourse = '';
let currentStudySpaceId = '';
const assignmentDialog = document.getElementById('assignment-dialog');
let openedAssignmentId = null;
let pendingStudyTaskEdit = null;
let progress = loadProgress();
const localDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });
const monthFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function loadStudyCourses() {
  try { const saved = JSON.parse(localStorage.getItem('my-space-study-courses-v1')); return Array.isArray(saved) ? saved.filter(name => typeof name === 'string' && name.trim()).slice(0, 300) : []; }
  catch { return []; }
}
function loadStudyTasks() {
  try { const saved = JSON.parse(localStorage.getItem('my-space-study-tasks-v1')); return Array.isArray(saved) ? saved.filter(validStudyTask) : []; }
  catch { return []; }
}
function validStudyTask(task) {
  if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(task.id) ||
      typeof task.title !== 'string' || !task.title.trim() || task.title.length > 120 ||
      typeof task.course !== 'string' || !task.course.trim() || task.course.length > 100 ||
      typeof task.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.date) ||
      typeof task.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time) ||
      (task.description !== undefined && (typeof task.description !== 'string' || task.description.length > 1000))) return false;
  const [year, month, day] = task.date.split('-').map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== task.date) return false;
  if (task.recurrence === undefined) return true;
  const until = task.recurrence?.until;
  if (task.recurrence?.frequency !== 'weekly' || typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  const [uy, um, ud] = until.split('-').map(Number);
  const days = (Date.UTC(uy, um - 1, ud) - Date.UTC(year, month - 1, day)) / 86400000;
  const exceptions = task.recurrence.exceptions ?? [];
  return new Date(Date.UTC(uy, um - 1, ud)).toISOString().slice(0, 10) === until && days >= 0 && days <= 3660 &&
    Array.isArray(exceptions) && exceptions.length <= 600 && exceptions.every(date => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const [ey, em, ed] = date.split('-').map(Number);
      const offset = (Date.UTC(ey, em - 1, ed) - Date.UTC(year, month - 1, day)) / 86400000;
      return new Date(Date.UTC(ey, em - 1, ed)).toISOString().slice(0, 10) === date && offset >= 0 && offset <= days && offset % 7 === 0;
    }) && new Set(exceptions).size === exceptions.length;
}
function saveStudyCourses() {
  try { localStorage.setItem('my-space-study-courses-v1', JSON.stringify(studyCourses)); scheduleSharedSave('studyCourses'); return true; }
  catch { return false; }
}
function saveStudyTasks() {
  try { localStorage.setItem('my-space-study-tasks-v1', JSON.stringify(studyTasks)); scheduleSharedSave('studyTasks'); return true; }
  catch { return false; }
}
function allStudyCourses() {
  return [...new Set([...assignments.map(item => item.course).filter(Boolean), ...studyCourses, ...studyTasks.map(item => item.course)])].sort((a, b) => a.localeCompare(b));
}
function studyTaskOnDate(task, day) {
  const difference = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${task.date}T00:00:00Z`)) / 86400000;
  if (!task.recurrence) return difference === 0;
  return difference >= 0 && difference % 7 === 0 && day <= task.recurrence.until && !(task.recurrence.exceptions || []).includes(day);
}
function studyTaskAssignment(task, day = task.date) {
  return { id: `study-task-${task.id}`, studyTaskId: task.id, occurrenceDate: day, title: task.title, course: task.course, description: task.description || '', date: day, time: task.time, due: `${day}T${task.time}:00`, allDay: false };
}
function studyAssignmentsForDate(day) {
  return [...assignments.filter(item => assignmentDateKey(item) === day), ...studyTasks.filter(task => studyTaskOnDate(task, day)).map(task => studyTaskAssignment(task, day))];
}
function studyListAssignments() {
  const studyEntries = studyTasks.map(task => {
    let day = task.date;
    while (task.recurrence && day <= task.recurrence.until && (task.recurrence.exceptions || []).includes(day)) {
      const next = new Date(`${day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      day = next.toISOString().slice(0, 10);
    }
    return !task.recurrence || day <= task.recurrence.until ? studyTaskAssignment(task, day) : null;
  }).filter(Boolean);
  return [...assignments, ...studyEntries];
}

function zurichDateKey(date) {
  const parts = Object.fromEntries(localDateFormatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function assignmentDateKey(item) {
  if (item.studyTaskId) return item.occurrenceDate || item.date;
  return item.allDay ? item.due : zurichDateKey(new Date(item.due));
}

const todayKey = () => zurichDateKey(new Date());
let selectedDate = todayKey();
let viewYear = Number(selectedDate.slice(0, 4));
let viewMonth = Number(selectedDate.slice(5, 7));

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-space-eth-progress-v1'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch { /* Use empty progress. */ }
  return {};
}

function saveProgress() {
  try { localStorage.setItem('my-space-eth-progress-v1', JSON.stringify(progress)); scheduleSharedSave('progress'); return true; }
  catch { return false; }
}

const statusOptions = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' }
];

function assignmentStatus(assignment) {
  const key = assignment.studyTaskId
    ? `${assignment.id}@${assignment.occurrenceDate || assignment.date}`
    : assignment.id;
  if (statusOptions.some(option => option.value === progress[key])) return progress[key];
  // Older manually added tasks stored one status for the whole recurring series.
  // Keep that status on its first date only; later occurrences start independently.
  if (assignment.studyTaskId) {
    const task = studyTasks.find(item => item.id === assignment.studyTaskId);
    const occurrenceDate = assignment.occurrenceDate || assignment.date;
    if (task?.date === occurrenceDate && statusOptions.some(option => option.value === progress[assignment.id])) return progress[assignment.id];
  }
  return 'not_started';
}

function assignmentProgressKey(assignment) {
  return assignment.studyTaskId ? `${assignment.id}@${assignment.occurrenceDate || assignment.date}` : assignment.id;
}

function setAssignmentStatus(assignment, value, index) {
  progress[assignmentProgressKey(assignment)] = value;
  const saved = saveProgress();
  renderCalendar();
  if (assignmentDialog.open && openedAssignmentId === assignment.id) {
    document.getElementById('assignment-detail-progress').replaceChildren(createDialogStatus(assignment));
    document.querySelector('#assignment-detail-progress :is(summary, .status-option[aria-pressed="true"])')?.focus();
  } else {
    renderAssignments();
    assignmentList.querySelectorAll('.status-picker summary')[index]?.focus();
  }
  if (!saved) studyStatus.textContent = 'Progress changed for now, but this browser could not save it.';
}

// In the assignment window on phones, show all three statuses as buttons: a dropdown
// there opens below the short info area and its last option needs scrolling.
const narrowAssignmentDialog = window.matchMedia('(max-width: 760px)');
function createDialogStatus(assignment) {
  if (!narrowAssignmentDialog.matches) return createStatusPicker(assignment);
  const current = assignmentStatus(assignment);
  const group = document.createElement('div');
  group.className = 'status-segments';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Progress for ${assignment.title}`);
  statusOptions.forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-option';
    button.dataset.status = option.value;
    button.setAttribute('aria-pressed', String(option.value === current));
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const label = document.createElement('span');
    label.textContent = option.label;
    button.append(dot, label);
    button.addEventListener('click', () => setAssignmentStatus(assignment, option.value));
    group.append(button);
  });
  return group;
}

function createStatusPicker(assignment, index) {
  const picker = document.createElement('details');
  picker.className = 'status-picker';
  picker.dataset.status = assignmentStatus(assignment);
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', `Progress for ${assignment.title}: ${statusOptions.find(option => option.value === picker.dataset.status).label}`);
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  const label = document.createElement('span');
  label.textContent = statusOptions.find(option => option.value === picker.dataset.status).label;
  const chevron = document.createElement('span');
  chevron.className = 'status-chevron';
  chevron.textContent = '⌄';
  summary.append(dot, label, chevron);
  picker.append(summary);
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  statusOptions.forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-option';
    button.dataset.status = option.value;
    button.setAttribute('aria-pressed', String(option.value === picker.dataset.status));
    const optionDot = document.createElement('span');
    optionDot.className = 'status-dot';
    const optionLabel = document.createElement('span');
    optionLabel.textContent = option.label;
    button.append(optionDot, optionLabel);
    button.addEventListener('click', () => setAssignmentStatus(assignment, option.value, index));
    menu.append(button);
  });
  picker.append(menu);
  picker.addEventListener('toggle', () => {
    if (picker.open) document.querySelectorAll('.status-picker[open]').forEach(other => { if (other !== picker) other.open = false; });
  });
  return picker;
}

document.addEventListener('click', event => {
  if (!event.target.closest('.status-picker')) document.querySelectorAll('.status-picker[open]').forEach(picker => { picker.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const picker = document.querySelector('.status-picker[open]');
    if (picker) { event.preventDefault(); picker.open = false; picker.querySelector('summary').focus(); }
  }
});

const dueFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric' });
const calendarTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
// Month cells are small: show "08:00" there; the tooltip and details keep the time zone.
const calendarShortTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function formatDue(item) {
  if (item.studyTaskId) return `${dateFormatter.format(new Date(`${item.occurrenceDate || item.date}T12:00:00Z`))} · ${item.time} Zurich`;
  if (item.allDay) return `${dateFormatter.format(new Date(`${item.due}T12:00:00Z`))} · All day`;
  return dueFormatter.format(new Date(item.due));
}

function calendarAssignmentTitle(title) {
  const clean = title.replace(/\s+(is due|ist fällig\.?|closes)$/i, '');
  const sheet = clean.match(/^Abgabe:\s*Blatt\s+(\d+)\s*\/\s*Sheet\s+\d+/i);
  if (sheet) return `Blatt ${sheet[1]} / Sheet ${sheet[1]}`;
  return clean;
}

function calendarCourseName(course) {
  return {
    'Theoretical Computer Science': 'Theoretical CS',
    'Numerical Methods for Computer Science': 'Numerical Methods'
  }[course] || course;
}

let filesLoadVersion = 0;
let filePreviewVersion = 0;
let uploadingAssignmentFiles = false;
let activePdfTask = null;
let activePdfObserver = null;

function clearFilePreview() {
  ++filePreviewVersion;
  if (activePdfObserver) { activePdfObserver.disconnect(); activePdfObserver = null; }
  if (activePdfTask) { activePdfTask.destroy().catch(() => {}); activePdfTask = null; }
  document.getElementById('assignment-file-preview').replaceChildren();
}

async function renderPdfPreview(file, container, version) {
  const viewer = document.createElement('div');
  viewer.className = 'pdf-viewer';
  const status = document.createElement('p');
  status.className = 'attachment-note';
  status.textContent = 'Loading PDF…';
  viewer.append(status);
  container.append(viewer);
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    if (version !== filePreviewVersion) return;
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ url: file.url, isEvalSupported: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/' });
    activePdfTask = task;
    const pdf = await task.promise;
    if (version !== filePreviewVersion) return;
    viewer.tabIndex = 0;
    viewer.setAttribute('role', 'region');
    viewer.setAttribute('aria-label', `${file.name}, scroll through ${pdf.numPages} pages`);
    const firstPage = await pdf.getPage(1);
    if (version !== filePreviewVersion) return;
    const initialSize = firstPage.getViewport({ scale: 1 });
    viewer.replaceChildren();

    async function renderPage(sheet) {
      if (version !== filePreviewVersion) return;
      const pageNumber = Number(sheet.dataset.page);
      const placeholder = sheet.querySelector('.pdf-page-content');
      try {
        const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
        if (version !== filePreviewVersion) return;
        const original = page.getViewport({ scale: 1 });
        const width = Math.max(1, placeholder.clientWidth);
        const viewport = page.getViewport({ scale: width / original.width * Math.min(devicePixelRatio || 1, 2) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${file.name}, page ${pageNumber} of ${pdf.numPages}`);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (version !== filePreviewVersion) return;
        placeholder.style.aspectRatio = `${original.width} / ${original.height}`;
        placeholder.replaceChildren(canvas);
        page.cleanup();
      } catch {
        if (version === filePreviewVersion) placeholder.textContent = 'Could not preview this page. You can download the PDF above.';
      }
    }

    // Render pages as they approach the viewport, keeping long files quick to open.
    let renderQueue = Promise.resolve();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        renderQueue = renderQueue.then(() => renderPage(entry.target));
      }
    }, { root: viewer, rootMargin: '600px 0px' });
    activePdfObserver = observer;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const sheet = document.createElement('div');
      sheet.className = 'pdf-page';
      sheet.dataset.page = pageNumber;
      const label = document.createElement('p');
      label.className = 'pdf-page-label';
      label.textContent = `${pageNumber} / ${pdf.numPages}`;
      const placeholder = document.createElement('div');
      placeholder.className = 'pdf-page-content';
      placeholder.style.aspectRatio = `${initialSize.width} / ${initialSize.height}`;
      placeholder.textContent = 'Loading page…';
      sheet.append(label, placeholder);
      viewer.append(sheet);
      observer.observe(sheet);
    }
  } catch {
    if (version === filePreviewVersion) {
      status.textContent = 'Could not preview this PDF. You can download it above.';
      viewer.replaceChildren(status);
    }
  }
}

async function showAssignmentFile(file, button) {
  clearFilePreview();
  const version = filePreviewVersion;
  document.querySelectorAll('.attachment-button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  const container = document.getElementById('assignment-file-preview');
  container.replaceChildren();
  if (!/^\/api\/assignment-files\/[0-9a-f]{32}$/.test(file.url)) return;
  const download = document.createElement('a');
  download.href = file.url;
  download.download = file.name;
  download.className = 'attachment-open';
  download.textContent = `Download ${file.name}`;
  container.append(download);
  if (file.type === 'application/pdf') {
    await renderPdfPreview(file, container, version);
  } else if (file.type.startsWith('image/')) {
    const preview = document.createElement('img');
    preview.className = 'attachment-preview';
    preview.title = file.name;
    preview.alt = file.name;
    preview.src = file.url;
    container.append(preview);
  } else if (file.type.startsWith('text/plain')) {
    const preview = document.createElement('pre');
    preview.className = 'attachment-text';
    preview.textContent = 'Loading preview…';
    container.append(preview);
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('Preview unavailable');
      const text = await response.text();
      if (version === filePreviewVersion) preview.textContent = text.slice(0, 500000) + (text.length > 500000 ? '\n… Download the file to read the rest.' : '');
    } catch {
      if (version === filePreviewVersion) preview.textContent = 'Could not load the preview. Try downloading the file.';
    }
  } else {
    const note = document.createElement('p');
    note.className = 'attachment-note';
    note.textContent = 'This file is saved. Download it to open in its own app.';
    container.append(note);
  }
}

async function loadAssignmentFiles(assignmentId, selectedFileId) {
  const version = ++filesLoadVersion;
  const note = document.getElementById('assignment-files-note');
  note.textContent = 'Loading files…';
  try {
    const response = await fetch(`/api/assignment-files?assignment=${encodeURIComponent(assignmentId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load files. Try reopening this assignment.');
    const { files } = await response.json();
    if (version !== filesLoadVersion || openedAssignmentId !== assignmentId) return;
    const list = document.getElementById('assignment-attachments');
    list.replaceChildren();
    note.textContent = files.length ? '' : 'Add your notes, exercise sheets or solutions.';
    files.forEach((file, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'attachment-button';
      button.textContent = file.name;
      button.addEventListener('click', () => showAssignmentFile(file, button));
      list.append(button);
      if (selectedFileId ? file.id === selectedFileId : index === 0) showAssignmentFile(file, button);
    });
  } catch (error) {
    if (version === filesLoadVersion && openedAssignmentId === assignmentId) note.textContent = error.message;
  }
}

const assignmentUpload = document.getElementById('assignment-file-upload');
const assignmentUploadButton = document.getElementById('upload-assignment-button');
assignmentUploadButton.addEventListener('click', () => assignmentUpload.click());
assignmentUpload.addEventListener('change', async () => {
  const assignmentId = openedAssignmentId;
  const files = [...assignmentUpload.files];
  assignmentUpload.value = '';
  if (!assignmentId || !files.length || uploadingAssignmentFiles) return;
  uploadingAssignmentFiles = true;
  assignmentUploadButton.disabled = true;
  ++filesLoadVersion;
  let lastFileId;
  let failure = '';
  try {
    for (const file of files) {
      if (!file.size || file.size > 20000000) throw new Error(`${file.name}: choose a non-empty file under 20 MB.`);
      if (openedAssignmentId === assignmentId) document.getElementById('assignment-files-note').textContent = `Uploading ${file.name}…`;
      const response = await fetch(`/api/assignment-files?assignment=${encodeURIComponent(assignmentId)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!response.ok) throw new Error(`Could not save ${file.name}. Please try again.`);
      lastFileId = (await response.json()).id;
    }
  } catch (error) {
    failure = error.message;
  } finally {
    uploadingAssignmentFiles = false;
    assignmentUploadButton.disabled = false;
    if (openedAssignmentId === assignmentId) {
      await loadAssignmentFiles(assignmentId, lastFileId);
      if (failure) document.getElementById('assignment-files-note').textContent = failure;
    }
  }
});

function openAssignmentDetails(assignment) {
  openedAssignmentId = assignment.id;
  document.getElementById('assignment-detail-title').textContent = calendarAssignmentTitle(assignment.title);
  document.getElementById('assignment-detail-course').textContent = assignment.course || 'Assignment';
  document.getElementById('assignment-detail-due').textContent = `Due ${formatDue(assignment)}`;
  document.getElementById('assignment-detail-description').textContent = assignment.description || '';
  const submission = assignment.submission;
  const submissionLink = document.getElementById('assignment-submission-link');
  const validSubmission = submission && /^https:\/\/moodle-app2\.let\.ethz\.ch\/(?:mod\/assign\/view\.php|calendar\/view\.php)\?/.test(submission.url);
  document.getElementById('assignment-submission').hidden = !validSubmission;
  const editTaskButton = document.getElementById('edit-study-task-detail');
  editTaskButton.hidden = !assignment.studyTaskId;
  editTaskButton.onclick = () => {
    pendingStudyTaskEdit = assignment.studyTaskId;
    assignmentDialog.close();
  };
  const occurrenceTask = assignment.studyTaskId && studyTasks.find(task => task.id === assignment.studyTaskId);
  const occurrenceDate = assignment.occurrenceDate || assignment.date || assignmentDateKey(assignment);
  const removeOccurrenceButton = document.getElementById('remove-study-occurrence');
  removeOccurrenceButton.hidden = !occurrenceTask?.recurrence || !studyTaskOnDate(occurrenceTask, occurrenceDate);
  const occurrenceConfirmDialog = document.getElementById('study-occurrence-confirm');
  if (occurrenceConfirmDialog.open) occurrenceConfirmDialog.close();
  const formattedOccurrenceDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${occurrenceDate}T12:00:00Z`));
  document.getElementById('study-occurrence-confirm-message').textContent = `Remove this task on ${formattedOccurrenceDate} only? Other dates will stay.`;
  removeOccurrenceButton.onclick = () => occurrenceConfirmDialog.showModal();
  document.getElementById('confirm-study-occurrence-remove').onclick = () => {
    if (occurrenceTask && removeStudyTaskOccurrence(occurrenceTask.id, occurrenceDate)) {
      occurrenceConfirmDialog.close();
      assignmentDialog.close();
    }
  };
  submissionLink.removeAttribute('href');
  if (validSubmission) {
    submissionLink.href = submission.url;
    submissionLink.textContent = submission.direct ? 'Open submission ↗' : 'View in Moodle ↗';
    document.getElementById('assignment-submission-note').textContent = submission.direct ? 'Submit your work on Moodle.' : 'Opens this deadline in Moodle. Follow its assignment link to submit.';
  }
  document.getElementById('assignment-detail-progress').replaceChildren(createDialogStatus(assignment));
  clearFilePreview();
  document.getElementById('assignment-attachments').replaceChildren();
  document.getElementById('assignment-file-preview').replaceChildren();
  loadAssignmentFiles(assignment.id);
  assignmentDialog.showModal();
}

document.getElementById('close-assignment-dialog').addEventListener('click', () => assignmentDialog.close());
document.getElementById('cancel-study-occurrence-remove').addEventListener('click', () => {
  document.getElementById('study-occurrence-confirm').close();
});
document.getElementById('study-occurrence-confirm').addEventListener('click', event => {
  const dialog = event.currentTarget;
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
assignmentDialog.addEventListener('click', event => {
  const box = assignmentDialog.getBoundingClientRect();
  if (event.target === assignmentDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) assignmentDialog.close();
});
assignmentDialog.addEventListener('close', () => {
  const occurrenceConfirmDialog = document.getElementById('study-occurrence-confirm');
  if (occurrenceConfirmDialog.open) occurrenceConfirmDialog.close();
  const trigger = [...(studySection === 'overview' ? calendarGrid : assignmentList).querySelectorAll('[data-assignment-id]')].find(item => item.dataset.assignmentId === openedAssignmentId);
  trigger?.focus({ preventScroll: true });
  openedAssignmentId = null;
  ++filesLoadVersion;
  clearFilePreview();
  document.getElementById('assignment-file-preview').replaceChildren();
  if (pendingStudyTaskEdit) {
    const taskId = pendingStudyTaskEdit;
    pendingStudyTaskEdit = null;
    openStudyTaskEditor(taskId);
  }
});

function renderStudyNavigation() {
  const base = `#${currentStudySpaceId}`;
  const overview = document.getElementById('study-overview-link');
  const all = document.getElementById('study-assignments-link');
  overview.href = base;
  all.href = `${base}/assignments`;
  overview.toggleAttribute('aria-current', studySection === 'overview');
  all.toggleAttribute('aria-current', studySection === 'assignments');
  if (studySection === 'overview') overview.setAttribute('aria-current', 'page');
  if (studySection === 'assignments') all.setAttribute('aria-current', 'page');
  document.getElementById('study-assignment-count').textContent = assignmentsLoaded || studyTasks.length ? assignments.length + studyTasks.length : '';
  document.getElementById('study-page-title').textContent = studySection === 'course' ? selectedCourse : studySection === 'assignments' ? 'Assignments' : 'Overview';
  document.getElementById('study-calendar-panel').hidden = studySection !== 'overview';
  document.getElementById('study-assignment-panel').hidden = studySection === 'overview';
  const navigation = document.getElementById('course-navigation');
  navigation.replaceChildren();
  const courses = allStudyCourses();
  courses.forEach(course => {
    const link = document.createElement('a');
    link.className = 'study-nav-link course-nav-link';
    link.href = `${base}/course/${encodeURIComponent(course)}`;
    if (studySection === 'course' && selectedCourse === course) link.setAttribute('aria-current', 'page');
    const mark = document.createElement('span');
    mark.className = 'course-mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = course;
    link.append(mark, label);
    navigation.append(link);
  });
  if (!courses.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = assignmentsLoaded ? 'No courses yet.' : 'Courses appear when deadlines load.';
    navigation.append(empty);
  }
}

function renderAssignments() {
  assignmentList.replaceChildren();
  const visible = studySection === 'overview' ? studyAssignmentsForDate(selectedDate)
    : studyListAssignments().filter(item => studySection !== 'course' || item.course === selectedCourse);
  document.getElementById('assignment-list-title').textContent = studySection === 'overview' ? dateFormatter.format(new Date(`${selectedDate}T12:00:00Z`)) : studySection === 'course' ? selectedCourse : 'All assignments';
  document.getElementById('assignment-count').textContent = `${visible.length} ${visible.length === 1 ? 'assignment' : 'assignments'}`;
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-assignments';
    empty.textContent = !assignmentsLoaded && !studyTasks.length ? 'Waiting for Moodle deadlines.' : studySection === 'overview' ? 'Nothing due on this day.' : studySection === 'course' ? 'No assignments for this course yet.' : 'No assignments yet.';
    assignmentList.append(empty);
    return;
  }
  visible.forEach((assignment, index) => {
    const item = document.createElement('li');
    item.classList.toggle('is-selected-date', studySection === 'overview');
    const info = document.createElement('div');
    info.className = 'assignment-info';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'assignment-title';
    title.dataset.assignmentId = assignment.id;
    title.textContent = assignment.title;
    title.addEventListener('click', () => openAssignmentDetails(assignment));
    const meta = document.createElement('span');
    meta.className = 'assignment-meta';
    const task = assignment.studyTaskId && studyTasks.find(item => item.id === assignment.studyTaskId);
    meta.textContent = `${formatDue(assignment)}${assignment.course ? ` · ${assignment.course}` : ''}${task?.recurrence ? ` · Weekly until ${dateFormatter.format(new Date(`${task.recurrence.until}T12:00:00Z`))}` : ''}`;
    info.append(title, meta);
    item.append(info, createStatusPicker(assignment, index));
    assignmentList.append(item);
  });
}

function renderCalendar() {
  document.getElementById('calendar-month').textContent = monthFormatter.format(new Date(Date.UTC(viewYear, viewMonth - 1, 1)));
  calendarGrid.replaceChildren();
  const firstWeekday = (new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('span');
    blank.className = 'calendar-blank';
    calendarGrid.append(blank);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dailyAssignments = studyAssignmentsForDate(key);
    const count = dailyAssignments.length;
    const button = document.createElement('div');
    button.className = 'calendar-day';
    if (key === todayKey()) button.classList.add('is-today');
    button.dataset.selected = String(key === selectedDate);
    const top = document.createElement('button');
    top.type = 'button';
    top.setAttribute('aria-pressed', String(key === selectedDate));
    top.setAttribute('aria-label', `${day} ${monthFormatter.format(new Date(Date.UTC(viewYear, viewMonth - 1, 1)))}: ${count} assignments`);
    top.className = 'day-top';
    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = day;
    top.append(number);
    if (count) {
      const marker = document.createElement('span');
      marker.className = 'day-count';
      marker.textContent = count;
      top.append(marker);
    }
    button.append(top);
    const previews = document.createElement('span');
    previews.className = 'day-previews';
    dailyAssignments.forEach(assignment => {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'day-preview';
      preview.dataset.assignmentId = assignment.id;
      preview.setAttribute('aria-label', `View ${calendarAssignmentTitle(assignment.title)} — ${assignment.course || 'Assignment'}`);
      preview.addEventListener('click', event => {
        event.stopPropagation();
        selectedDate = key;
        renderCalendar();
        openAssignmentDetails(assignment);
      });
      preview.dataset.status = assignmentStatus(assignment);
      preview.title = `${assignment.title} · ${formatDue(assignment)}${assignment.course ? ` · ${assignment.course}` : ''}`;
      const previewTitle = document.createElement('span');
      previewTitle.className = 'day-preview-title';
      previewTitle.textContent = calendarAssignmentTitle(assignment.title);
      const previewCourse = document.createElement('span');
      previewCourse.className = 'day-preview-course';
      previewCourse.textContent = calendarCourseName(assignment.course);
      const previewTime = document.createElement('span');
      previewTime.className = 'day-preview-time';
      previewTime.textContent = assignment.studyTaskId ? assignment.time : assignment.allDay ? 'All day' : calendarShortTimeFormatter.format(new Date(assignment.due));
      preview.append(previewTitle, previewCourse, previewTime);
      previews.append(preview);
    });
    button.append(previews);
    if (count) {
      // Phones show these instead of titles: one coloured circle per status with its count.
      const dots = document.createElement('span');
      dots.className = 'day-dots';
      const tally = new Map([['not_started', 0], ['in_progress', 0], ['done', 0]]);
      dailyAssignments.forEach(assignment => {
        const status = assignmentStatus(assignment);
        tally.set(status, (tally.get(status) || 0) + 1);
      });
      tally.forEach((n, status) => {
        if (!n) return;
        const badge = document.createElement('span');
        badge.className = 'day-more-badge';
        badge.dataset.status = status;
        badge.textContent = n;
        dots.append(badge);
      });
      button.append(dots);
    }
    button.dataset.date = key;
    calendarDayItems.set(key, dailyAssignments);
    button.addEventListener('click', () => {
      selectedDate = key;
      renderCalendar();
      // Clicking a day (anywhere but on one item's line) lists everything due that day.
      if (count) openDayList(key);
    });
    calendarGrid.append(button);
  }
  renderAssignments();
  requestAnimationFrame(fitDayPreviews);
}

// ---- Month cells: show what fits, then "+N more" (opens the day's full list).
const calendarDayItems = new Map();

function fitDayPreviews() {
  calendarGrid.querySelectorAll('.calendar-day').forEach(day => {
    const box = day.querySelector('.day-previews');
    if (!box) return;
    box.querySelector('.day-more')?.remove();
    const items = [...box.querySelectorAll('.day-preview')];
    items.forEach(item => { item.hidden = false; });
    if (!items.length || box.offsetParent === null || box.scrollHeight <= box.clientHeight + 1) return;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'day-more';
    more.addEventListener('click', event => {
      event.stopPropagation();
      openDayList(day.dataset.date);
    });
    box.append(more);
    more.textContent = '+0';
    let hidden = 0;
    for (let i = items.length - 1; i >= 0 && box.scrollHeight > box.clientHeight + 1; i--) {
      items[i].hidden = true;
      hidden++;
    }
    // "②①": one coloured circle per status (not started / in progress / done) with how many are hidden.
    const label = { not_started: 'not started', in_progress: 'in progress', done: 'done' };
    const tally = new Map(Object.keys(label).map(status => [status, 0]));
    items.filter(item => item.hidden).forEach(item => tally.set(item.dataset.status, (tally.get(item.dataset.status) || 0) + 1));
    const badges = [...tally].filter(([, n]) => n).map(([status, n]) => {
      const badge = document.createElement('span');
      badge.className = 'day-more-badge';
      badge.dataset.status = status;
      badge.textContent = n;
      return badge;
    });
    more.replaceChildren(...badges);
    more.title = `${hidden} more: ${[...tally].filter(([, n]) => n).map(([status, n]) => `${n} ${label[status] || status}`).join(', ')}`;
    more.setAttribute('aria-label', `Show all ${items.length} items on ${day.dataset.date}; ${more.title}`);
  });
}
new ResizeObserver(() => fitDayPreviews()).observe(calendarGrid);

const dayListDialog = document.getElementById('day-list-dialog');
function openDayList(key) {
  const items = calendarDayItems.get(key) || [];
  const [year, month, dayOfMonth] = key.split('-').map(Number);
  document.getElementById('day-list-title').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, dayOfMonth)));
  const list = document.getElementById('day-list-items');
  list.replaceChildren(...items.map(assignment => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'day-list-item';
    row.dataset.status = assignmentStatus(assignment);
    const title = document.createElement('strong');
    title.textContent = calendarAssignmentTitle(assignment.title);
    const meta = document.createElement('span');
    meta.textContent = [assignment.studyTaskId ? `${assignment.time} Zurich` : assignment.allDay ? 'All day' : calendarTimeFormatter.format(new Date(assignment.due)), assignment.course].filter(Boolean).join(' · ');
    row.append(title, meta);
    row.addEventListener('click', () => {
      dayListDialog.close();
      openAssignmentDetails(assignment);
    });
    return row;
  }));
  dayListDialog.showModal();
}
document.getElementById('close-day-list').addEventListener('click', () => dayListDialog.close());
dayListDialog.addEventListener('click', event => { if (event.target === dayListDialog) dayListDialog.close(); });

function moveMonth(delta) {
  const month = new Date(Date.UTC(viewYear, viewMonth - 1 + delta, 1));
  viewYear = month.getUTCFullYear();
  viewMonth = month.getUTCMonth() + 1;
  selectedDate = `${viewYear}-${String(viewMonth).padStart(2, '0')}-01`;
  renderCalendar();
}

document.getElementById('previous-month').addEventListener('click', () => moveMonth(-1));
document.getElementById('next-month').addEventListener('click', () => moveMonth(1));
document.getElementById('calendar-today').addEventListener('click', () => {
  selectedDate = todayKey();
  viewYear = Number(selectedDate.slice(0, 4));
  viewMonth = Number(selectedDate.slice(5, 7));
  renderCalendar();
});

async function loadAssignments(force = false) {
  if (location.protocol === 'file:') {
    studyStatus.textContent = 'Open My Space from its web address to load Moodle deadlines.';
    return;
  }
  refreshAssignmentsButton.disabled = true;
  studyStatus.textContent = 'Loading Moodle deadlines…';
  try {
    const response = await fetch(`/api/assignments${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Feed unavailable');
    const data = await response.json();
    if (!Array.isArray(data.assignments)) throw new Error('Invalid feed');
    assignments = data.assignments;
    if (!assignmentsLoaded) {
      const next = assignments.find(item => item.allDay ? assignmentDateKey(item) >= todayKey() : new Date(item.due).getTime() >= Date.now());
      if (next) {
        selectedDate = assignmentDateKey(next);
        viewYear = Number(selectedDate.slice(0, 4));
        viewMonth = Number(selectedDate.slice(5, 7));
      }
    }
    assignmentsLoaded = true;
    renderStudyNavigation();
    renderCalendar();
    studyStatus.textContent = `${assignments.length} deadlines · Zurich time · Updated ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich', timeZoneName: 'short' }).format(new Date())}`;
  } catch {
    studyStatus.textContent = 'Moodle deadlines are unavailable right now. Try Refresh in a moment.';
  } finally {
    refreshAssignmentsButton.disabled = false;
  }
}

refreshAssignmentsButton.addEventListener('click', () => loadAssignments(true));
setInterval(() => { if (!document.hidden && assignmentsLoaded) loadAssignments(); }, 10 * 60 * 1000);

const studyTaskDialog = document.getElementById('study-task-dialog');
const studyTaskForm = document.getElementById('study-task-form');
const studyCourseDialog = document.getElementById('study-course-dialog');
const studyCourseForm = document.getElementById('study-course-form');
let editingStudyTaskId = null;
let addTaskAfterCourse = false;

function populateStudyCourseOptions(selected = '') {
  const select = document.getElementById('study-task-course');
  select.replaceChildren();
  allStudyCourses().forEach(course => {
    const option = document.createElement('option');
    option.value = course;
    option.textContent = course;
    select.append(option);
  });
  if (selected && allStudyCourses().includes(selected)) select.value = selected;
}

function openStudyTaskEditor(id = null) {
  editingStudyTaskId = id;
  const task = id ? studyTasks.find(item => item.id === id) : null;
  studyTaskForm.reset();
  document.getElementById('study-task-dialog-title').textContent = task ? 'Edit study task' : 'Add study task';
  document.getElementById('study-task-name').value = task?.title || '';
  document.getElementById('study-task-description').value = task?.description || '';
  document.getElementById('study-task-date').value = task?.date || selectedDate;
  document.getElementById('study-task-time').value = task?.time || '23:59';
  document.getElementById('study-task-repeat').checked = Boolean(task?.recurrence);
  document.getElementById('study-task-repeat-end').hidden = !task?.recurrence;
  document.getElementById('study-task-until').value = task?.recurrence?.until || '';
  document.getElementById('study-task-delete').hidden = !task;
  document.getElementById('study-task-delete-confirm').hidden = true;
  document.getElementById('study-task-error').textContent = '';
  populateStudyCourseOptions(task?.course || (studySection === 'course' ? selectedCourse : ''));
  studyTaskDialog.showModal();
}

document.getElementById('study-task-repeat').addEventListener('change', event => {
  document.getElementById('study-task-repeat-end').hidden = !event.target.checked;
  if (event.target.checked && !document.getElementById('study-task-until').value) {
    const defaultUntil = new Date(`${document.getElementById('study-task-date').value || todayKey()}T12:00:00`);
    defaultUntil.setMonth(defaultUntil.getMonth() + 3);
    document.getElementById('study-task-until').value = `${defaultUntil.getFullYear()}-${String(defaultUntil.getMonth() + 1).padStart(2, '0')}-${String(defaultUntil.getDate()).padStart(2, '0')}`;
  }
});
document.getElementById('study-task-date').addEventListener('change', event => {
  const until = document.getElementById('study-task-until');
  if (document.getElementById('study-task-repeat').checked && until.value && until.value < event.target.value) until.value = event.target.value;
});
document.getElementById('study-add-task').addEventListener('click', () => {
  if (!allStudyCourses().length) {
    addTaskAfterCourse = true;
    studyCourseForm.reset();
    document.getElementById('study-course-error').textContent = 'Add a course first, then create your task.';
    studyCourseDialog.showModal();
    return;
  }
  openStudyTaskEditor();
});
document.getElementById('study-add-course').addEventListener('click', () => {
  addTaskAfterCourse = false;
  studyCourseForm.reset();
  document.getElementById('study-course-error').textContent = '';
  studyCourseDialog.showModal();
});
document.getElementById('study-course-close').addEventListener('click', () => studyCourseDialog.close());
document.getElementById('study-course-cancel').addEventListener('click', () => { addTaskAfterCourse = false; studyCourseDialog.close(); });
studyCourseForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = document.getElementById('study-course-name').value.trim();
  if (!name) return;
  if (allStudyCourses().some(course => course.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    document.getElementById('study-course-error').textContent = 'That course is already in your list.';
    return;
  }
  studyCourses.push(name);
  saveStudyCourses();
  renderStudyNavigation();
  populateStudyCourseOptions(name);
  const openTask = addTaskAfterCourse;
  addTaskAfterCourse = false;
  studyCourseDialog.close();
  if (openTask) openStudyTaskEditor();
});
document.getElementById('study-task-close').addEventListener('click', () => studyTaskDialog.close());
document.getElementById('study-task-cancel').addEventListener('click', () => studyTaskDialog.close());
document.getElementById('study-task-delete').addEventListener('click', () => {
  document.getElementById('study-task-delete-confirm').hidden = false;
});
document.getElementById('study-task-delete-cancel').addEventListener('click', () => {
  document.getElementById('study-task-delete-confirm').hidden = true;
});
function removeStudyTaskOccurrence(taskId, date) {
  const task = studyTasks.find(item => item.id === taskId);
  if (!task?.recurrence || !date || !studyTaskOnDate(task, date)) return false;
  const progressPrefix = `study-task-${taskId}`;
  studyTasks = studyTasks.map(item => item.id === taskId
    ? { ...item, recurrence: { ...item.recurrence, exceptions: [...new Set([...(item.recurrence.exceptions || []), date])].sort() } }
    : item);
  delete progress[`${progressPrefix}@${date}`];
  if (date === task.date) delete progress[progressPrefix];
  saveProgress();
  saveStudyTasks();
  renderStudyNavigation();
  renderCalendar();
  return true;
}
document.getElementById('study-task-delete-confirm-button').addEventListener('click', () => {
  if (!editingStudyTaskId) return;
  const taskId = editingStudyTaskId;
  const progressPrefix = `study-task-${taskId}`;
  studyTasks = studyTasks.filter(task => task.id !== taskId);
  Object.keys(progress).filter(key => key === progressPrefix || key.startsWith(`${progressPrefix}@`)).forEach(key => delete progress[key]);
  saveProgress();
  saveStudyTasks();
  studyTaskDialog.close();
  renderStudyNavigation();
  renderCalendar();
});
studyTaskForm.addEventListener('submit', event => {
  event.preventDefault();
  const previousTask = studyTasks.find(item => item.id === editingStudyTaskId);
  const title = document.getElementById('study-task-name').value.trim();
  const course = document.getElementById('study-task-course').value;
  const date = document.getElementById('study-task-date').value;
  const time = document.getElementById('study-task-time').value;
  const repeats = document.getElementById('study-task-repeat').checked;
  const until = document.getElementById('study-task-until').value;
  if (!course || !title || !date || !time) {
    document.getElementById('study-task-error').textContent = 'Add a title, course, date, and time.';
    return;
  }
  if (repeats && (!until || until < date)) {
    document.getElementById('study-task-error').textContent = 'Choose an Until date on or after the first task.';
    return;
  }
  const task = {
    id: editingStudyTaskId || `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title, course, date, time, description: document.getElementById('study-task-description').value.trim()
  };
  if (repeats) task.recurrence = {
    frequency: 'weekly', until,
    exceptions: previousTask?.recurrence && previousTask.date === date
      ? (previousTask.recurrence.exceptions || []).filter(day => day <= until) : []
  };
  const next = editingStudyTaskId ? studyTasks.map(item => item.id === editingStudyTaskId ? task : item) : [...studyTasks, task];
  if (!validStudyTask(task)) {
    document.getElementById('study-task-error').textContent = 'Please check the date and repeat end date.';
    return;
  }
  studyTasks = next;
  saveStudyTasks();
  studyTaskDialog.close();
  renderStudyNavigation();
  renderCalendar();
});

const personalSpaceId = 'space-mv6h7fv7-ef7n7';
const personalCalendar = document.getElementById('personal-week-calendar');
const personalMonthCalendar = document.getElementById('personal-month-calendar');
const personalScroll = document.getElementById('personal-calendar-scroll');
const personalTaskDialog = document.getElementById('personal-task-dialog');
const personalTaskForm = document.getElementById('personal-task-form');
const personalHourHeight = 48;
let personalTasks = loadPersonalTasks();
let personalRepeatUntil = '';
try { personalRepeatUntil = localStorage.getItem('my-space-personal-repeat-until') || ''; } catch { /* Use the default date. */ }
const personalPresetColors = new Set(['#a97975', '#5485b5', '#5a9275', '#9573b5', '#bd8d3f']);
let personalSavedColors = [];
let pendingPersonalColorRemoval = null;
try {
  const saved = localStorage.getItem('my-space-personal-colors');
  personalSavedColors = normalizePersonalColors(saved === null ? personalTasks.map(task => task.color) : JSON.parse(saved));
} catch { /* Start with the presets. */ }
let personalWeekStart = mondayFor(new Date());
let personalMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
let personalCalendarView = localStorage.getItem('my-space-personal-calendar-view') === 'month' ? 'month' : 'week';
let editingPersonalTaskId = null;
let editingPersonalOccurrenceDate = null;
let personalReturnFocus = null;
let personalCalendarOpened = false;
// The week view opens scrolled to that week's first event, and keeps following it (e.g. when
// shared data arrives after a refresh) until the user scrolls or touches the calendar.
let personalWeekAutoScroll = true;
let personalTimeSelection = null;

// Adding by dragging starts only after a long press, so a plain swipe scrolls the calendar
// (on phones) and a stray click adds nothing. Hold still, then drag to set the length.
const personalLongPressMs = 450;
let personalLongPress = null;

function cancelPersonalLongPress() {
  const press = personalLongPress;
  if (!press) return;
  personalLongPress = null;
  clearTimeout(press.timer);
  press.track.classList.remove('is-pressing');
}

function armPersonalLongPress(event, track, date) {
  if (event.button !== 0 || !event.isPrimary || event.target.closest('.personal-task')) return;
  clearPersonalTimeSelection();
  const press = { track, date, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
  press.timer = setTimeout(() => {
    if (personalLongPress !== press) return;
    cancelPersonalLongPress();
    navigator.vibrate?.(12);
    startPersonalTimeSelection({ button: 0, isPrimary: true, target: track, pointerId: press.pointerId, clientY: press.y, preventDefault() {} }, track, date);
  }, personalLongPressMs);
  // Show which slot is being pressed (touch screens have no hover to show it).
  const minute = Math.min(23 * 60 + 45, Math.max(0, Math.floor((event.clientY - track.getBoundingClientRect().top) / (personalHourHeight / 4)) * 15));
  track.style.setProperty('--hover-slot', `${minute / 60 * personalHourHeight}px`);
  track.dataset.hoverTime = timeFor(minute);
  track.classList.add('is-pressing');
  personalLongPress = press;
}

function clearPersonalTimeSelection() {
  cancelPersonalLongPress();
  const selection = personalTimeSelection;
  if (!selection) return;
  personalTimeSelection = null;
  cancelAnimationFrame(selection.frame);
  selection.preview.remove();
  selection.track.classList.remove('is-selecting');
  if (selection.track.hasPointerCapture(selection.pointerId)) selection.track.releasePointerCapture(selection.pointerId);
}

function updatePersonalTimeSelection(clientY) {
  const selection = personalTimeSelection;
  if (!selection) return;
  selection.clientY = clientY;
  if (Math.abs(clientY - selection.initialY) >= 4) selection.dragged = true;
  const minute = Math.max(0, Math.min(1440, Math.round((clientY - selection.track.getBoundingClientRect().top) / personalHourHeight * 60 / 15) * 15));
  selection.start = selection.dragged ? Math.min(selection.anchor, minute) : selection.anchor;
  selection.end = Math.min(1439, selection.dragged ? Math.max(selection.anchor + (minute === selection.anchor ? 15 : 0), minute) : selection.anchor + 60);
  selection.preview.style.top = `${selection.start / 60 * personalHourHeight}px`;
  selection.preview.style.height = `${(selection.end - selection.start) / 60 * personalHourHeight}px`;
  selection.preview.textContent = `${timeFor(selection.start)}–${timeFor(selection.end)}`;
}

function startPersonalTimeSelection(event, track, date) {
  if (event.button !== 0 || !event.isPrimary || event.target.closest('.personal-task')) return;
  event.preventDefault();
  clearPersonalTimeSelection();
  track.focus({ preventScroll: true });
  const y = event.clientY - track.getBoundingClientRect().top;
  const anchor = Math.max(0, Math.min(1425, Math.floor(y / personalHourHeight * 60 / 15) * 15));
  const preview = document.createElement('div');
  preview.className = 'personal-time-selection';
  track.append(preview);
  track.classList.add('is-selecting');
  personalTimeSelection = { track, date, preview, anchor, pointerId: event.pointerId, initialY: event.clientY, clientY: event.clientY, dragged: false, frame: null };
  try { track.setPointerCapture(event.pointerId); } catch { /* The pointer already ended; pointerup is handled below. */ }
  updatePersonalTimeSelection(event.clientY);
  let previousTime;
  const scrollSelection = timestamp => {
    const selection = personalTimeSelection;
    if (!selection || selection.track !== track) return;
    const elapsed = Math.min(32, previousTime === undefined ? 16 : timestamp - previousTime);
    previousTime = timestamp;
    if (selection.dragged) {
      const bounds = personalScroll.getBoundingClientRect();
      const top = bounds.top + 54;
      const speed = selection.clientY < top + 28 ? -Math.min(1, (top + 28 - selection.clientY) / 28)
        : selection.clientY > bounds.bottom - 28 ? Math.min(1, (selection.clientY - bounds.bottom + 28) / 28) : 0;
      if (speed) {
        personalScroll.scrollTop += speed * elapsed * 0.55;
        updatePersonalTimeSelection(selection.clientY);
      }
    }
    selection.frame = requestAnimationFrame(scrollSelection);
  };
  personalTimeSelection.frame = requestAnimationFrame(scrollSelection);
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && personalTimeSelection) {
    event.preventDefault();
    clearPersonalTimeSelection();
  }
});
window.addEventListener('blur', clearPersonalTimeSelection);
// Once a long press has started a selection, finger movement resizes it instead of scrolling.
personalScroll.addEventListener('touchmove', event => { if (personalTimeSelection) event.preventDefault(); }, { passive: false });
personalScroll.addEventListener('scroll', cancelPersonalLongPress, { passive: true });
for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
  personalScroll.addEventListener(type, () => { personalWeekAutoScroll = false; }, { passive: true });
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function mondayFor(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return monday;
}

function minutesFor(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function timeFor(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function utcDayNumber(key) {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function validPersonalTask(task) {
  if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(task.id) ||
      typeof task.title !== 'string' || !task.title.trim() || task.title.length > 100 ||
      (task.description !== undefined && (typeof task.description !== 'string' || task.description.length > 1000)) ||
      (task.color !== undefined && (typeof task.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(task.color))) ||
      (task.showInMonth !== undefined && typeof task.showInMonth !== 'boolean') ||
      typeof task.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.date) || localDateKey(dateFromKey(task.date)) !== task.date ||
      typeof task.start !== 'string' || typeof task.end !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.end) ||
      minutesFor(task.start) >= minutesFor(task.end)) return false;
  if (task.completedDates !== undefined && (!Array.isArray(task.completedDates) || task.completedDates.length > 600 ||
      task.completedDates.some(day => typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || localDateKey(dateFromKey(day)) !== day) ||
      new Set(task.completedDates).size !== task.completedDates.length)) return false;
  if (task.recurrence === undefined) return !task.completedDates?.some(day => day !== task.date);
  const recurrence = task.recurrence;
  if (!recurrence || typeof recurrence !== 'object' || recurrence.frequency !== 'weekly' ||
      typeof recurrence.until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(recurrence.until) ||
      localDateKey(dateFromKey(recurrence.until)) !== recurrence.until ||
      !Array.isArray(recurrence.exceptions) || recurrence.exceptions.length > 600) return false;
  const firstDay = utcDayNumber(task.date);
  const lastDay = utcDayNumber(recurrence.until);
  if (lastDay < firstDay || lastDay - firstDay > 3660) return false;
  return !(task.completedDates || []).some(day => utcDayNumber(day) < firstDay || utcDayNumber(day) > lastDay ||
    (utcDayNumber(day) - firstDay) % 7 !== 0) && recurrence.exceptions.every(day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    localDateKey(dateFromKey(day)) === day && utcDayNumber(day) >= firstDay && utcDayNumber(day) <= lastDay &&
    (utcDayNumber(day) - firstDay) % 7 === 0) &&
    new Set(recurrence.exceptions).size === recurrence.exceptions.length;
}

function firstEventScrollTop(dates) {
  let earliest = null;
  dates.forEach(date => personalOccurrencesOnDate(localDateKey(date)).forEach(task => {
    const start = minutesFor(task.start);
    if (earliest === null || start < earliest) earliest = start;
  }));
  // The full hour of the first event (08:15 → 08:00); 08:00 for an empty week. The 10px
  // margin keeps that hour's label clear of the sticky day headings.
  return Math.max(0, Math.floor((earliest ?? 8 * 60) / 60) * personalHourHeight - 10);
}

function personalOccurrencesOnDate(key, tasks = personalTasks) {
  const targetDay = utcDayNumber(key);
  return tasks.filter(task => {
    if (!task.recurrence) return task.date === key;
    const firstDay = utcDayNumber(task.date);
    return targetDay >= firstDay && key <= task.recurrence.until &&
      (targetDay - firstDay) % 7 === 0 && !task.recurrence.exceptions.includes(key);
  }).map(task => ({ ...task, occurrenceDate: key }));
}

function layoutPersonalDayTasks(tasks) {
  const entries = tasks.map(task => {
    const top = minutesFor(task.start) / 60 * personalHourHeight + 1;
    const height = Math.max(20, (minutesFor(task.end) - minutesFor(task.start)) / 60 * personalHourHeight - 2);
    return { task, top, height, bottom: top + height, column: 0, columns: 1 };
  }).sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.task.id.localeCompare(b.task.id));
  let group = [];
  let columnEnds = [];
  let groupEnd = -Infinity;
  const finishGroup = () => group.forEach(entry => { entry.columns = columnEnds.length; });
  entries.forEach(entry => {
    if (entry.top >= groupEnd) {
      finishGroup();
      group = [];
      columnEnds = [];
    }
    let column = columnEnds.findIndex(end => end <= entry.top);
    if (column === -1) column = columnEnds.length;
    entry.column = column;
    columnEnds[column] = entry.bottom;
    group.push(entry);
    groupEnd = Math.max(groupEnd, entry.bottom);
  });
  finishGroup();
  return entries;
}

function loadPersonalTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-space-personal-tasks-v1'));
    if (Array.isArray(saved)) return saved.filter(validPersonalTask);
  } catch { /* Start with an empty calendar. */ }
  return [];
}

function savePersonalTasks(next) {
  try {
    localStorage.setItem('my-space-personal-tasks-v1', JSON.stringify(next));
    personalTasks = next;
    scheduleSharedSave('personalTasks');
    renderPersonalCalendar();
    return true;
  } catch {
    document.getElementById('personal-task-error').textContent = 'Could not save this task. Please try again.';
    return false;
  }
}

function personalWeekDates() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(personalWeekStart);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function applyPersonalTaskColor(button, task) {
  if (!task.color) return;
  button.classList.add('has-color');
  button.style.setProperty('--task-color', task.color);
}

function renderPersonalWeek() {
  clearPersonalTimeSelection();
  const dates = personalWeekDates();
  const first = dates[0], last = dates[6];
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long' });
  document.getElementById('personal-week-label').textContent = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
    ? `${first.getDate()}–${last.getDate()} ${month.format(last)} ${last.getFullYear()}`
    : `${first.getDate()} ${month.format(first)} – ${last.getDate()} ${month.format(last)} ${last.getFullYear()}`;
  const currentScroll = personalScroll.scrollTop;
  const fragment = document.createDocumentFragment();
  const corner = document.createElement('div');
  corner.className = 'personal-calendar-corner';
  fragment.append(corner);
  dates.forEach(date => {
    const heading = document.createElement('div');
    heading.className = 'personal-day-heading';
    if (localDateKey(date) === localDateKey(new Date())) heading.classList.add('is-today');
    heading.innerHTML = `<span>${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date)}</span><strong>${date.getDate()}</strong>`;
    fragment.append(heading);
  });
  const timeAxis = document.createElement('div');
  timeAxis.className = 'personal-time-axis';
  for (let hour = 0; hour < 24; hour++) {
    const label = document.createElement('span');
    label.style.top = `${hour ? hour * personalHourHeight : 8}px`;
    if (!hour) label.classList.add('is-midnight');
    label.textContent = timeFor(hour * 60);
    timeAxis.append(label);
  }
  fragment.append(timeAxis);
  dates.forEach((date, index) => {
    const key = localDateKey(date);
    const track = document.createElement('div');
    track.className = 'personal-day-track';
    if (index % 2) track.classList.add('is-alt');
    track.tabIndex = 0;
    track.setAttribute('role', 'button');
    track.setAttribute('aria-label', `Choose a time on ${new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)}`);
    track.addEventListener('pointermove', event => {
      const press = personalLongPress;
      if (press?.track === track && press.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelPersonalLongPress();
        return;
      }
      if (personalTimeSelection?.track === track && personalTimeSelection.pointerId === event.pointerId) {
        updatePersonalTimeSelection(event.clientY);
        return;
      }
      const y = event.clientY - track.getBoundingClientRect().top;
      const minute = Math.min(23 * 60 + 45, Math.max(0, Math.floor(y / (personalHourHeight / 4)) * 15));
      track.style.setProperty('--hover-slot', `${minute / 60 * personalHourHeight}px`);
      track.dataset.hoverTime = timeFor(minute);
    });
    track.addEventListener('pointerdown', event => armPersonalLongPress(event, track, key));
    track.addEventListener('contextmenu', event => { if (personalLongPress || personalTimeSelection) event.preventDefault(); });
    track.addEventListener('pointerup', event => {
      if (personalLongPress?.pointerId === event.pointerId) { cancelPersonalLongPress(); return; }
      const selection = personalTimeSelection;
      if (selection?.track !== track || selection.pointerId !== event.pointerId) return;
      updatePersonalTimeSelection(event.clientY);
      clearPersonalTimeSelection();
      openPersonalTaskEditor(null, selection.date, timeFor(selection.start), timeFor(selection.end));
    });
    track.addEventListener('pointercancel', clearPersonalTimeSelection);
    track.addEventListener('lostpointercapture', clearPersonalTimeSelection);
    track.addEventListener('keydown', event => {
      if (event.target !== track || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openPersonalTaskEditor(null, key, '09:00', '10:00');
    });
    layoutPersonalDayTasks(personalOccurrencesOnDate(key)).forEach(({ task, top, height, column, columns }) => {
      const button = document.createElement('button');
      button.className = 'personal-task';
      applyPersonalTaskColor(button, task);
      const isDone = task.completedDates?.includes(task.occurrenceDate);
      button.classList.toggle('is-done', Boolean(isDone));
      button.type = 'button';
      button.style.top = `${top}px`;
      button.style.height = `${height}px`;
      button.style.left = `calc(${column / columns * 100}% + var(--task-inset, 5px))`;
      button.style.right = `calc(${(columns - column - 1) / columns * 100}% + var(--task-inset, 5px))`;
      button.setAttribute('aria-label', `${task.title}, ${task.start} to ${task.end}${task.description ? `, ${task.description}` : ''}${isDone ? ', done' : ''}${task.recurrence ? ', repeats weekly' : ''}. Edit task`);
      button.title = [task.title, task.description, `${task.start}–${task.end}`, task.recurrence ? 'Repeats every week' : ''].filter(Boolean).join('\n');
      const duration = minutesFor(task.end) - minutesFor(task.start);
      const title = document.createElement('strong');
      // Markers in their own span so very thin cards can drop them and keep the title.
      if (isDone || task.recurrence) {
        const marks = document.createElement('span');
        marks.className = 'personal-task-marks';
        marks.textContent = `${isDone ? '✓ ' : ''}${task.recurrence ? '↻ ' : ''}`;
        title.append(marks);
      }
      title.append(task.title);
      button.append(title);
      if (duration >= 60 && (!task.description || duration >= 90)) {
        const time = document.createElement('span');
        time.textContent = `${task.start}–${task.end}`;
        button.append(time);
      }
      if (task.description) {
        const description = document.createElement('small');
        description.textContent = task.description;
        button.append(description);
      }
      button.addEventListener('click', event => { event.stopPropagation(); openPersonalTaskEditor(task); });
      track.append(button);
    });
    fragment.append(track);
  });
  personalCalendar.replaceChildren(fragment);
  personalScroll.scrollTop = personalWeekAutoScroll ? firstEventScrollTop(dates) : currentScroll;
  personalCalendarOpened = true;
  requestAnimationFrame(markOverflowingTaskCards);
}

// Cards whose text doesn't fit fade out at the bottom instead of cutting a line in half;
// the fade goes away once the card is scrolled to its end.
function markOverflowingTaskCards() {
  personalCalendar.querySelectorAll('.personal-task').forEach(updateTaskCardFade);
}
function updateTaskCardFade(card) {
  card.classList.toggle('is-overflowing', card.scrollHeight - card.scrollTop - card.clientHeight > 2);
}
personalCalendar.addEventListener('scroll', event => {
  if (event.target.classList?.contains('personal-task')) updateTaskCardFade(event.target);
}, { capture: true, passive: true });
new ResizeObserver(() => markOverflowingTaskCards()).observe(personalCalendar);

function renderPersonalMonth() {
  const year = personalMonthDate.getFullYear();
  const monthIndex = personalMonthDate.getMonth();
  document.getElementById('personal-week-label').textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(personalMonthDate);
  const first = new Date(year, monthIndex, 1, 12);
  const start = mondayFor(first);
  const daysInMonth = new Date(year, monthIndex + 1, 0, 12).getDate();
  const cellCount = Math.ceil(((first.getDay() + 6) % 7 + daysInMonth) / 7) * 7;
  personalMonthCalendar.style.setProperty('--personal-month-weeks', cellCount / 7);
  const fragment = document.createDocumentFragment();
  for (let day = 0; day < 7; day++) {
    const heading = document.createElement('div');
    heading.className = 'personal-month-weekday';
    const date = new Date(start);
    date.setDate(date.getDate() + day);
    heading.textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date);
    fragment.append(heading);
  }
  for (let index = 0; index < cellCount; index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const key = localDateKey(date);
    const day = document.createElement('div');
    day.className = 'personal-month-day';
    if (date.getMonth() !== monthIndex) day.classList.add('is-outside');
    if (key === localDateKey(new Date())) day.classList.add('is-today');
    day.tabIndex = 0;
    day.setAttribute('role', 'button');
    day.setAttribute('aria-label', `Add task on ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`);
    day.addEventListener('click', event => {
      if (!event.target.closest('.personal-month-task')) openPersonalTaskEditor(null, key, '09:00', '10:00');
    });
    day.addEventListener('keydown', event => {
      if (event.target !== day || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openPersonalTaskEditor(null, key, '09:00', '10:00');
    });
    const number = document.createElement('span');
    number.className = 'personal-month-number';
    number.textContent = date.getDate();
    day.append(number);
    const items = document.createElement('div');
    items.className = 'personal-month-items';
    personalOccurrencesOnDate(key).filter(task => task.showInMonth !== false).sort((a, b) => a.start.localeCompare(b.start)).forEach(task => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'personal-month-task';
      applyPersonalTaskColor(button, task);
      const isDone = task.completedDates?.includes(task.occurrenceDate);
      button.classList.toggle('is-done', Boolean(isDone));
      button.title = [task.title, task.description, `${task.start}–${task.end}`, task.recurrence ? 'Repeats every week' : ''].filter(Boolean).join('\n');
      button.setAttribute('aria-label', `${task.title}, ${task.start} to ${task.end}${task.description ? `, ${task.description}` : ''}${isDone ? ', done' : ''}${task.recurrence ? ', repeats weekly' : ''}. Edit task`);
      const time = document.createElement('span');
      time.textContent = task.start;
      const title = document.createElement('strong');
      title.textContent = `${isDone ? '✓ ' : ''}${task.recurrence ? '↻ ' : ''}${task.title}`;
      button.append(time, title);
      if (task.description) {
        const description = document.createElement('small');
        description.textContent = task.description;
        button.append(description);
      }
      button.addEventListener('click', event => { event.stopPropagation(); openPersonalTaskEditor(task); });
      items.append(button);
    });
    day.append(items);
    fragment.append(day);
  }
  personalMonthCalendar.replaceChildren(fragment);
}

function renderPersonalCalendar() {
  const monthView = personalCalendarView === 'month';
  personalCalendar.hidden = monthView;
  personalMonthCalendar.hidden = !monthView;
  document.getElementById('personal-month-view').setAttribute('aria-pressed', String(monthView));
  document.getElementById('personal-week-view').setAttribute('aria-pressed', String(!monthView));
  document.getElementById('personal-this-week').textContent = monthView ? 'This month' : 'This week';
  document.getElementById('personal-prev-week').setAttribute('aria-label', monthView ? 'Previous month' : 'Previous week');
  document.getElementById('personal-next-week').setAttribute('aria-label', monthView ? 'Next month' : 'Next week');
  document.getElementById('personal-hint').textContent = monthView
    ? 'Select a day to add a task. Select a task to change it.'
    : 'Long-press a time to add a schedule; keep holding and drag to set its length. Select a task to change it.';
  if (monthView) renderPersonalMonth();
  else renderPersonalWeek();
}

function openPersonalTaskEditor(task, date, start, end) {
  hidePersonalColorConfirmation();
  editingPersonalTaskId = task?.id || null;
  editingPersonalOccurrenceDate = task?.occurrenceDate || null;
  personalReturnFocus = document.activeElement;
  document.getElementById('personal-task-dialog-title').textContent = task?.recurrence ? 'Edit schedule' : task ? 'Edit task' : 'Add schedule';
  document.getElementById('personal-task-name').value = task?.title || '';
  document.getElementById('personal-task-description').value = task?.description || '';
  document.getElementById('personal-task-done-field').hidden = !task;
  document.getElementById('personal-task-done').checked = Boolean(task?.completedDates?.includes(task.occurrenceDate || task.date));
  document.getElementById('personal-task-color').value = task?.color || '#a97975';
  renderSavedPersonalColors();
  updatePersonalColorSelection();
  document.getElementById('personal-task-date').value = task?.date || date || localDateKey(new Date());
  document.getElementById('personal-task-start').value = task?.start || start || '09:00';
  document.getElementById('personal-task-end').value = task?.end || end || '10:00';
  document.getElementById('personal-task-repeat').checked = Boolean(task?.recurrence);
  document.getElementById('personal-task-show-month').checked = task?.showInMonth !== false;
  const until = task?.recurrence?.until || (() => {
    const firstDay = document.getElementById('personal-task-date').value;
    // Schedules saved before the preference existed still provide the last used date.
    const lastUntil = personalRepeatUntil || [...personalTasks].reverse().find(item => item.recurrence)?.recurrence.until;
    if (validPersonalRepeatUntil(lastUntil, firstDay)) return lastUntil;
    const endDate = dateFromKey(firstDay);
    endDate.setDate(endDate.getDate() + 28);
    return localDateKey(endDate);
  })();
  document.getElementById('personal-task-until').value = until;
  updatePersonalRepeatFields();
  const note = document.getElementById('personal-repeat-note');
  note.hidden = !task?.recurrence;
  if (task?.recurrence) note.textContent = `This schedule repeats weekly. Changes to its details affect every week${editingPersonalOccurrenceDate ? `; “Done for this date” and “Remove this week” affect only ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(dateFromKey(editingPersonalOccurrenceDate))}.` : '.'}`;
  document.getElementById('personal-skip-week').hidden = !task?.recurrence || !editingPersonalOccurrenceDate;
  document.getElementById('personal-delete-task').hidden = !task;
  document.getElementById('personal-delete-task').textContent = task?.recurrence ? 'Delete schedule' : 'Delete task';
  document.getElementById('personal-task-error').textContent = '';
  personalTaskDialog.showModal();
  document.getElementById('personal-task-name').focus();
}

function updatePersonalRepeatFields() {
  const repeating = document.getElementById('personal-task-repeat').checked;
  document.getElementById('personal-repeat-end').hidden = !repeating;
  document.getElementById('personal-task-until').required = repeating;
  document.querySelector('label[for="personal-task-date"]').textContent = repeating ? 'First day' : 'Day';
}

function updatePersonalColorSelection() {
  const color = document.getElementById('personal-task-color').value;
  document.querySelectorAll('[data-task-color]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.taskColor === color));
  });
}
function normalizePersonalColors(colors) {
  return [...new Set((Array.isArray(colors) ? colors : []).filter(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    .map(color => color.toLowerCase()).filter(color => !personalPresetColors.has(color)))].slice(-1000);
}

function renderSavedPersonalColors() {
  const colors = personalSavedColors;
  const container = document.getElementById('personal-saved-colors');
  container.replaceChildren(...colors.map(color => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.taskColor = color;
    button.style.setProperty('--swatch', color);
    button.setAttribute('aria-label', `Use saved color ${color}`);
    button.title = color;
    const wrapper = document.createElement('span');
    wrapper.className = 'personal-saved-swatch';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'personal-remove-color';
    remove.dataset.removeTaskColor = color;
    remove.setAttribute('aria-label', `Remove saved color ${color}`);
    remove.title = 'Remove saved color';
    remove.textContent = '×';
    wrapper.append(button, remove);
    return wrapper;
  }));
  document.getElementById('personal-saved-color-field').hidden = !colors.length;
  updatePersonalColorSelection();
}

function rememberPersonalColors(colors) {
  const next = normalizePersonalColors([...personalSavedColors, ...colors]);
  if (JSON.stringify(next) === JSON.stringify(personalSavedColors)) return;
  personalSavedColors = next;
  try { localStorage.setItem('my-space-personal-colors', JSON.stringify(next)); } catch { /* The server can still save the palette. */ }
  scheduleSharedSave('personalSavedColors');
  renderSavedPersonalColors();
}

function hidePersonalColorConfirmation() {
  pendingPersonalColorRemoval = null;
  document.getElementById('personal-color-confirm').hidden = true;
}

function cancelPersonalColorRemoval() {
  const color = pendingPersonalColorRemoval;
  hidePersonalColorConfirmation();
  const trigger = [...document.querySelectorAll('[data-remove-task-color]')].find(button => button.dataset.removeTaskColor === color);
  (trigger || document.getElementById('personal-task-color')).focus();
}

document.getElementById('personal-cancel-color-remove').addEventListener('click', cancelPersonalColorRemoval);
document.getElementById('personal-confirm-color-remove').addEventListener('click', () => {
    if (!pendingPersonalColorRemoval) return;
    personalSavedColors = personalSavedColors.filter(color => color !== pendingPersonalColorRemoval);
    hidePersonalColorConfirmation();
    try { localStorage.setItem('my-space-personal-colors', JSON.stringify(personalSavedColors)); } catch { /* The server can still save the palette. */ }
    scheduleSharedSave('personalSavedColors');
    renderSavedPersonalColors();
    document.getElementById('personal-task-color').focus();
});
personalTaskDialog.addEventListener('cancel', event => {
  if (!pendingPersonalColorRemoval) return;
  event.preventDefault();
  cancelPersonalColorRemoval();
});
personalTaskDialog.addEventListener('close', hidePersonalColorConfirmation);
personalTaskDialog.addEventListener('click', event => {
  const remove = event.target.closest('[data-remove-task-color]');
  if (remove) {
    pendingPersonalColorRemoval = remove.dataset.removeTaskColor;
    document.getElementById('personal-color-confirm-swatch').style.background = pendingPersonalColorRemoval;
    document.getElementById('personal-color-confirm').hidden = false;
    document.getElementById('personal-cancel-color-remove').focus();
    return;
  }
  const button = event.target.closest('[data-task-color]');
  if (!button) return;
  hidePersonalColorConfirmation();
  document.getElementById('personal-task-color').value = button.dataset.taskColor;
  updatePersonalColorSelection();
});
document.getElementById('personal-task-color').addEventListener('input', updatePersonalColorSelection);
document.getElementById('personal-task-color').addEventListener('change', event => rememberPersonalColors([event.target.value]));

function validPersonalRepeatUntil(until, firstDay) {
  return /^\d{4}-\d{2}-\d{2}$/.test(until) && localDateKey(dateFromKey(until)) === until &&
    until >= firstDay && utcDayNumber(until) - utcDayNumber(firstDay) <= 3660;
}

function rememberPersonalRepeatUntil() {
  const until = document.getElementById('personal-task-until').value;
  if (!document.getElementById('personal-task-repeat').checked ||
      !validPersonalRepeatUntil(until, document.getElementById('personal-task-date').value) || until === personalRepeatUntil) return;
  personalRepeatUntil = until;
  try { localStorage.setItem('my-space-personal-repeat-until', until); } catch { /* The server can still save this preference. */ }
  scheduleSharedSave('personalRepeatUntil');
}

document.getElementById('personal-task-repeat').addEventListener('change', updatePersonalRepeatFields);
document.getElementById('personal-task-until').addEventListener('input', rememberPersonalRepeatUntil);
document.getElementById('personal-task-until').addEventListener('change', rememberPersonalRepeatUntil);

document.getElementById('personal-add-task').addEventListener('click', () => {
  const today = localDateKey(new Date());
  const visibleDates = personalCalendarView === 'month'
    ? [today, localDateKey(personalMonthDate)]
    : personalWeekDates().map(localDateKey);
  const date = personalCalendarView === 'month'
    ? (new Date().getMonth() === personalMonthDate.getMonth() && new Date().getFullYear() === personalMonthDate.getFullYear() ? today : visibleDates[1])
    : (visibleDates.includes(today) ? today : visibleDates[0]);
  openPersonalTaskEditor(null, date, '09:00', '10:00');
});
document.getElementById('personal-month-view').addEventListener('click', () => {
  if (personalCalendarView === 'month') return;
  const middle = new Date(personalWeekStart);
  middle.setDate(middle.getDate() + 3);
  personalMonthDate = new Date(middle.getFullYear(), middle.getMonth(), 1, 12);
  personalCalendarView = 'month';
  localStorage.setItem('my-space-personal-calendar-view', personalCalendarView);
  renderPersonalCalendar();
  personalScroll.scrollTop = 0;
});
document.getElementById('personal-week-view').addEventListener('click', () => {
  if (personalCalendarView === 'week') return;
  const weekMiddle = new Date(personalWeekStart);
  weekMiddle.setDate(weekMiddle.getDate() + 3);
  if (weekMiddle.getMonth() !== personalMonthDate.getMonth() || weekMiddle.getFullYear() !== personalMonthDate.getFullYear()) {
    const today = new Date();
    const target = today.getMonth() === personalMonthDate.getMonth() && today.getFullYear() === personalMonthDate.getFullYear()
      ? today : personalMonthDate;
    personalWeekStart = mondayFor(target);
  }
  personalCalendarView = 'week';
  localStorage.setItem('my-space-personal-calendar-view', personalCalendarView);
  personalWeekAutoScroll = true;
  renderPersonalCalendar();
});
document.getElementById('personal-prev-week').addEventListener('click', () => {
  if (personalCalendarView === 'month') personalMonthDate.setMonth(personalMonthDate.getMonth() - 1);
  else { personalWeekStart.setDate(personalWeekStart.getDate() - 7); personalWeekAutoScroll = true; }
  renderPersonalCalendar();
});
document.getElementById('personal-next-week').addEventListener('click', () => {
  if (personalCalendarView === 'month') personalMonthDate.setMonth(personalMonthDate.getMonth() + 1);
  else { personalWeekStart.setDate(personalWeekStart.getDate() + 7); personalWeekAutoScroll = true; }
  renderPersonalCalendar();
});
document.getElementById('personal-this-week').addEventListener('click', () => {
  const today = new Date();
  personalWeekStart = mondayFor(today);
  personalMonthDate = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  personalWeekAutoScroll = true;
  renderPersonalCalendar();
  if (personalCalendarView === 'month') personalScroll.scrollTop = 0;
});
document.getElementById('personal-close-task').addEventListener('click', () => personalTaskDialog.close());
document.getElementById('personal-cancel-task').addEventListener('click', () => personalTaskDialog.close());
personalTaskDialog.addEventListener('close', () => { if (personalReturnFocus?.isConnected) personalReturnFocus.focus({ preventScroll: true }); });
personalTaskForm.addEventListener('submit', event => {
  event.preventDefault();
  const previousTask = personalTasks.find(item => item.id === editingPersonalTaskId);
  const task = {
    id: editingPersonalTaskId || crypto.randomUUID(),
    title: document.getElementById('personal-task-name').value.trim(),
    color: document.getElementById('personal-task-color').value,
    showInMonth: document.getElementById('personal-task-show-month').checked,
    date: document.getElementById('personal-task-date').value,
    start: document.getElementById('personal-task-start').value,
    end: document.getElementById('personal-task-end').value
  };
  const description = document.getElementById('personal-task-description').value.trim();
  if (description) task.description = description;
  if (document.getElementById('personal-task-repeat').checked) {
    const until = document.getElementById('personal-task-until').value;
    task.recurrence = {
      frequency: 'weekly',
      until,
      exceptions: previousTask?.recurrence && previousTask.date === task.date
        ? previousTask.recurrence.exceptions.filter(day => day <= until) : []
    };
  }
  const completionDate = editingPersonalOccurrenceDate || previousTask?.date || task.date;
  const completedDates = (previousTask?.completedDates || []).filter(day => day >= task.date &&
    (task.recurrence ? day <= task.recurrence.until && (utcDayNumber(day) - utcDayNumber(task.date)) % 7 === 0 : day === task.date));
  if (document.getElementById('personal-task-done').checked &&
      (task.recurrence ? completionDate >= task.date && completionDate <= task.recurrence.until &&
        (utcDayNumber(completionDate) - utcDayNumber(task.date)) % 7 === 0 : completionDate === task.date)) {
    if (!completedDates.includes(completionDate)) completedDates.push(completionDate);
  } else {
    const completionIndex = completedDates.indexOf(completionDate);
    if (completionIndex >= 0) completedDates.splice(completionIndex, 1);
  }
  if (completedDates.length) task.completedDates = completedDates;
  const error = document.getElementById('personal-task-error');
  if (!validPersonalTask(task)) { error.textContent = 'Check the dates and choose an end time after the start time.'; return; }
  const next = editingPersonalTaskId ? personalTasks.map(item => item.id === task.id ? task : item) : [...personalTasks, task];
  const displayDate = task.recurrence && previousTask?.recurrence && previousTask.date === task.date && editingPersonalOccurrenceDate
    ? editingPersonalOccurrenceDate : task.date;
  const displayDay = dateFromKey(displayDate);
  personalWeekStart = mondayFor(displayDay);
  personalMonthDate = new Date(displayDay.getFullYear(), displayDay.getMonth(), 1, 12);
  if (savePersonalTasks(next)) {
    rememberPersonalRepeatUntil();
    personalWeekAutoScroll = false;
    personalScroll.scrollTop = personalCalendarView === 'month' ? 0 : Math.max(0, minutesFor(task.start) / 60 * personalHourHeight - 120);
    personalTaskDialog.close();
  }
});
document.getElementById('personal-delete-task').addEventListener('click', () => {
  const task = personalTasks.find(item => item.id === editingPersonalTaskId);
  if (task && window.confirm(task.recurrence ? `Delete “${task.title}” from every week?` : `Delete “${task.title}”?`)) {
    if (savePersonalTasks(personalTasks.filter(item => item.id !== task.id))) personalTaskDialog.close();
  }
});
document.getElementById('personal-skip-week').addEventListener('click', () => {
  const task = personalTasks.find(item => item.id === editingPersonalTaskId);
  if (!task?.recurrence || !editingPersonalOccurrenceDate) return;
  const next = personalTasks.map(item => item.id === task.id
    ? { ...item, recurrence: { ...item.recurrence, exceptions: [...item.recurrence.exceptions, editingPersonalOccurrenceDate].sort() } }
    : item);
  if (savePersonalTasks(next)) personalTaskDialog.close();
});

// The main page shows one of these two spaces; any other address opens the last one used.
const studySpaceId = 'space-mv6d516l-yqzp9';
const mainSpaces = [
  { id: studySpaceId, title: 'Study_ETH', icon: 'notes', color: '#e7e9f6' },
  { id: personalSpaceId, title: 'Schedule', icon: 'notes', color: '#e9e5f6' }
];
function lastMainSpace() {
  try { return localStorage.getItem('my-space-main-space') === personalSpaceId ? personalSpaceId : studySpaceId; }
  catch { return studySpaceId; }
}

function renderRoute() {
  let [route, section, ...courseParts] = location.hash.slice(1).split('/');
  if (!mainSpaces.some(item => item.id === route)) {
    route = lastMainSpace();
    section = undefined;
    courseParts = [];
    history.replaceState(null, '', `#${route}`);
  }
  try { localStorage.setItem('my-space-main-space', route); } catch { /* Defaults to Study_ETH next time. */ }
  const space = spaces.find(item => item.id === route) || mainSpaces.find(item => item.id === route);
  for (const main of mainSpaces) {
    const link = document.getElementById(main.id === studySpaceId ? 'switch-study' : 'switch-schedule');
    link.textContent = (spaces.find(item => item.id === main.id) || main).title;
    if (main.id === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const isStudy = Boolean(space && isEthSpace(space));
  const isPersonal = Boolean(space && (space.id === personalSpaceId || space.title.trim().toLowerCase() === 'personal'));
  const fileStudy = isStudy && location.protocol === 'file:';
  document.getElementById('home-view').hidden = Boolean(space);
  document.getElementById('space-view').hidden = !space || isStudy || isPersonal;
  document.getElementById('personal-view').hidden = !isPersonal;
  document.getElementById('study-view').hidden = !isStudy;
  document.getElementById('connection-notice').hidden = !fileStudy;
  document.getElementById('study-workspace').hidden = fileStudy;
  if (isStudy) {
    currentStudySpaceId = space.id;
    try { selectedCourse = decodeURIComponent(courseParts.join('/')); } catch { selectedCourse = ''; }
    studySection = section === 'assignments' ? 'assignments' : section === 'course' && selectedCourse ? 'course' : 'overview';
    renderStudyNavigation();
    renderAssignments();
  }
  if (isStudy && !fileStudy && !assignmentsLoaded) loadAssignments();
  if (isStudy) document.getElementById('study-title').textContent = space.title;
  if (isPersonal) {
    document.getElementById('personal-title').textContent = space.title;
    renderPersonalCalendar();
  }
  if (space && !isStudy && !isPersonal) {
    document.getElementById('space-title').textContent = space.title;
    document.getElementById('space-description').textContent = `A place for everything you want to keep in ${space.title}.`;
    const icon = document.getElementById('space-icon');
    icon.style.background = space.color;
    setSpaceIcon(icon, space);
  }
  document.title = space ? `${space.title} · My Space` : 'My Space';
  window.scrollTo(0, 0);
}

function sharedSnapshot(keys = ['spaces', 'trash', 'progress', 'background', 'theme', 'personalTasks', 'personalRepeatUntil', 'personalSavedColors', 'studyCourses', 'studyTasks', 'homeTodos']) {
  const values = { spaces, trash: trashedSpaces, progress, background: currentBackgroundChoice, theme: displayTheme, personalTasks, personalRepeatUntil, personalSavedColors, studyCourses, studyTasks, homeTodos };
  return Object.fromEntries(keys.map(key => [key, values[key]]));
}

async function putSharedState(snapshot) {
  const response = await fetch('/api/state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot)
  });
  if (!response.ok) throw new Error('Could not save local shared data.');
  return response.json();
}

function scheduleSharedSave(key) {
  if (!sharedStateReady) return;
  const value = JSON.parse(JSON.stringify(sharedSnapshot([key])[key]));
  sharedSaveChain = sharedSaveChain.then(() => putSharedState({ [key]: value })).then(result => {
    sharedRevision = result.revision;
  }).catch(() => { /* Keep local browser data; retry when the user refreshes. */ });
}

function applySharedState(state) {
  if (!Array.isArray(state.spaces) || !Array.isArray(state.trash) || !state.progress || !state.background) return;
  spaces = state.spaces.filter(isValidSpace);
  trashedSpaces = state.trash.filter(item => isValidSpace(item?.space) && Number.isInteger(item.originalIndex) && item.originalIndex >= 0);
  progress = state.progress;
  personalTasks = Array.isArray(state.personalTasks) ? state.personalTasks.filter(validPersonalTask) : [];
  if (Array.isArray(state.homeTodos)) homeTodos = state.homeTodos.filter(validHomeTodo).slice(0, 500);
  studyCourses = Array.isArray(state.studyCourses) ? state.studyCourses.filter(name => typeof name === 'string' && name.trim()).slice(0, 300) : studyCourses;
  studyTasks = Array.isArray(state.studyTasks) ? state.studyTasks.filter(validStudyTask) : studyTasks;
  if (typeof state.personalRepeatUntil === 'string') personalRepeatUntil = state.personalRepeatUntil;
  if (Array.isArray(state.personalSavedColors)) personalSavedColors = normalizePersonalColors(state.personalSavedColors);
  sharedRevision = state.revision;
  if (state.theme === 'day' || state.theme === 'night') applyTheme(state.theme);
  try {
    localStorage.setItem('my-space-spaces-v1', JSON.stringify(spaces));
    localStorage.setItem('my-space-trash-v1', JSON.stringify(trashedSpaces));
    localStorage.setItem('my-space-eth-progress-v1', JSON.stringify(progress));
    localStorage.setItem('my-space-personal-tasks-v1', JSON.stringify(personalTasks));
    localStorage.setItem('my-space-personal-repeat-until', personalRepeatUntil);
    localStorage.setItem('my-space-personal-colors', JSON.stringify(personalSavedColors));
    localStorage.setItem('my-space-study-courses-v1', JSON.stringify(studyCourses));
    localStorage.setItem('my-space-study-tasks-v1', JSON.stringify(studyTasks));
    localStorage.setItem('my-space-home-todos-v1', JSON.stringify(homeTodos));
    localStorage.setItem('my-space-background', JSON.stringify(state.background));
  } catch { /* Shared state remains available from the server. */ }
  if (!sharedStateReady || JSON.stringify(state.background) !== JSON.stringify(currentBackgroundChoice)) {
    releaseBackgroundUrl();
    imageUrl = state.background.type === 'image' ? `/api/background-image?v=${state.revision}` : null;
    currentBackgroundChoice = state.background;
    applyChoice(currentBackgroundChoice);
  }
  renderTiles();
  renderTrash();
  renderCalendar();
  renderHomeTodos();
  renderRoute();
}

async function refreshSharedState(allowHidden = false) {
  if ((!allowHidden && document.hidden) || dragContext || personalTimeSelection || document.querySelector('dialog[open]')) return;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) return;
    const state = await response.json();
    if (dragContext || personalTimeSelection || document.querySelector('dialog[open]')) return;
    if (state.initialized && (!sharedStateReady || state.revision > sharedRevision)) {
      applySharedState(state);
      sharedStateReady = true;
      if (!Array.isArray(state.homeTodos)) scheduleSharedSave('homeTodos');
    } else if (!state.initialized) {
      const initial = sharedSnapshot();
      await putSharedState(initial);
      sharedStateReady = true;
      const stored = await fetch('/api/state', { cache: 'no-store' });
      if (stored.ok) {
        const saved = await stored.json();
        sharedRevision = saved.revision || 0;
      }
    }
  } catch { /* Keep the saved local view while the server restarts. */ }
}

async function initializeSharedState() {
  await loadChoice();
  await refreshSharedState(true);
  const sync = () => refreshSharedState();
  setInterval(sync, 4000);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}

const refreshAppButton = document.getElementById('refresh-app');
async function refreshAppContent() {
  refreshAppButton.disabled = true;
  refreshAppButton.querySelector('.refresh-app-label').textContent = 'Updating…';
  try {
    await sharedSaveChain;
    await refreshSharedState(true);
    // Refresh the Moodle cache as part of the app update; it will be reused after reload.
    await loadAssignments(true);
  } catch { /* Reload the latest app even when a data source is temporarily unavailable. */ }
  window.location.reload();
}
window.mySpaceServerStartFailed = () => {
  refreshAppButton.disabled = false;
  refreshAppButton.querySelector('.refresh-app-label').textContent = 'Retry Refresh';
};
refreshAppButton.addEventListener('click', async () => {
  const nativeServerBridge = window.webkit?.messageHandlers?.ensureLocalServer;
  if (nativeServerBridge) {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('Server is not ready.');
    } catch {
      refreshAppButton.disabled = true;
      refreshAppButton.querySelector('.refresh-app-label').textContent = 'Starting Server…';
      nativeServerBridge.postMessage('start');
      return;
    }
  }
  await refreshAppContent();
});

// The app is not zoomable: block pinch (iOS Safari gesture events, which ignore the viewport
// tag, and trackpad pinch, which arrives as ctrl+wheel). Keyboard zoom stays available.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, event => event.preventDefault(), { passive: false });
}
window.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });

document.getElementById('logout').addEventListener('click', async () => {
  try { await sharedSaveChain; await fetch('/api/logout', { method: 'POST' }); } catch { /* Reload shows the login page either way. */ }
  window.location.reload();
});

window.addEventListener('hashchange', () => {
  clearPersonalTimeSelection();
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  renderRoute();
});
renderTiles();
renderTrash();
renderCalendar();
renderHomeTodos();
renderRoute();
initializeSharedState();

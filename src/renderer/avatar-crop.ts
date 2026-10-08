import { dismiss, h } from './dom';

const VIEW = 260; // diameter in px of the circle the person positions the photo in
const OUT = 128; // size of the saved picture
const MAX_ZOOM = 4;

/**
 * Opens a dialog to choose which part of a picture becomes the profile photo: drag to move it, slider or mouse wheel to zoom.
 * Resolves with a 128x128 JPEG data URL, or null when the person cancels or the file is not an image.
 */
export function cropAvatar(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = h('img', { alt: '', draggable: false, class: 'crop-img' });
    let nw = 0;
    let nh = 0;
    let zoom = 1; // 1 = the picture just covers the circle
    let ox = 0; // offset of the picture's center from the circle's center, in px
    let oy = 0;
    let done = false;

    const baseScale = () => VIEW / Math.min(nw, nh);
    const scale = () => baseScale() * zoom;
    const clamp = () => {
      const mx = Math.max(0, (nw * scale() - VIEW) / 2);
      const my = Math.max(0, (nh * scale() - VIEW) / 2);
      ox = Math.min(mx, Math.max(-mx, ox));
      oy = Math.min(my, Math.max(-my, oy));
    };
    const draw = () => {
      clamp();
      const s = scale();
      img.style.width = `${nw * s}px`;
      img.style.height = `${nh * s}px`;
      img.style.left = `${VIEW / 2 + ox - (nw * s) / 2}px`;
      img.style.top = `${VIEW / 2 + oy - (nh * s) / 2}px`;
      slider.style.setProperty('--v', `${((zoom - 1) / (MAX_ZOOM - 1)) * 100}%`);
    };

    const slider = h('input', { type: 'range', min: 1, max: MAX_ZOOM, step: 0.01, value: '1', class: 'volume crop-zoom', title: 'Zoom', 'aria-label': 'Zoom' });
    slider.addEventListener('input', () => {
      zoom = Number(slider.value);
      draw();
    });

    const frame = h('div', { class: 'crop-frame' }, img);
    frame.style.width = frame.style.height = `${VIEW}px`;
    let drag: { x: number; y: number; ox: number; oy: number } | null = null;
    frame.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, ox, oy };
      frame.setPointerCapture(e.pointerId);
      frame.classList.add('dragging');
    });
    frame.addEventListener('pointermove', (e) => {
      if (!drag) return;
      ox = drag.ox + (e.clientX - drag.x);
      oy = drag.oy + (e.clientY - drag.y);
      draw();
    });
    const endDrag = () => {
      drag = null;
      frame.classList.remove('dragging');
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
        slider.value = String(zoom);
        draw();
      },
      { passive: false },
    );

    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      URL.revokeObjectURL(url);
      dismiss(overlay);
      resolve(result);
    };
    const save = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = OUT;
      const g = canvas.getContext('2d')!;
      const s = scale();
      const left = VIEW / 2 + ox - (nw * s) / 2; // where the picture starts inside the circle's square
      const top = VIEW / 2 + oy - (nh * s) / 2;
      g.drawImage(img, -left / s, -top / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
      finish(canvas.toDataURL('image/jpeg', 0.88));
    };

    const saveBtn = h('button', { onclick: save, disabled: true }, 'Usar esta foto');
    const overlay = h(
      'div',
      { class: 'overlay crop-overlay' },
      h(
        'div',
        { class: 'dialog crop-dialog', role: 'dialog', 'aria-label': 'Ajustar foto de perfil' },
        h('h2', {}, 'Ajustar foto'),
        h('p', { class: 'muted' }, 'Arraste para escolher a parte da imagem e use o zoom para aproximar.'),
        frame,
        h('div', { class: 'crop-zoom-row' }, h('span', { class: 'muted' }, '−'), slider, h('span', { class: 'muted' }, '+')),
        h('div', { class: 'row crop-actions' }, h('button', { class: 'ghost', onclick: () => finish(null) }, 'Cancelar'), saveBtn),
      ),
    );
    // Esc cancels only this dialog, not the profile dialog underneath it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      finish(null);
    };
    document.addEventListener('keydown', onKey, true);

    img.onload = () => {
      nw = img.naturalWidth;
      nh = img.naturalHeight;
      if (!nw || !nh) return finish(null);
      saveBtn.disabled = false;
      draw();
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      URL.revokeObjectURL(url);
      overlay.remove();
      reject(new Error('unreadable image'));
    };
    img.src = url;
    document.body.append(overlay);
  });
}

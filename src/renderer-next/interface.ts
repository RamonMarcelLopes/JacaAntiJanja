import { S } from './state';

/** Switches to the other interface (the window reloads). Refused while a room is open: the room would end. */
export async function switchInterface(ui: 'legacy' | 'next'): Promise<boolean> {
  if (S.view === 'room') return false;
  return window.jaca.setUi(ui);
}

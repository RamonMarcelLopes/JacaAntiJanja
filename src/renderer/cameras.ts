import { CaptureSource } from '../shared/protocol';

/**
 * The cameras of this PC. The names only show up once the camera was allowed, so when they come empty the camera is opened for an
 * instant (and closed again) to get the permission.
 */
export async function listCameras(): Promise<CaptureSource[]> {
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (devices.length && devices.some((d) => !d.label)) {
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop());
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      /* not allowed (Windows privacy settings): the cameras are listed without names */
    }
  }
  return devices.map((d, i) => ({ id: `camera:${d.deviceId}`, name: d.label || `Câmera ${i + 1}`, thumbnail: '', isScreen: false }));
}

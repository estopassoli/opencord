import { describe, expect, it } from 'vitest';
import { hardwareIdOf } from '../electron/shared/hardware-id';

describe('impressão digital do aparelho (bloqueio de dispositivo)', () => {
  const eth = { mac: 'AA:BB:CC:DD:EE:01', internal: false };
  const wifi = { mac: 'aa:bb:cc:dd:ee:02', internal: false };
  it('hash estável dos MACs físicos, independente da ordem e de maiúsculas; ignora loopback e MAC zerado', () => {
    const a = hardwareIdOf({ eth0: [eth], wlan0: [wifi], lo: [{ mac: '00:00:00:00:00:00', internal: true }] });
    const b = hardwareIdOf({ wlan0: [{ mac: 'AA:BB:CC:DD:EE:02', internal: false }], eth0: [eth] });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(hardwareIdOf({ vpn: [{ mac: '00:00:00:00:00:00', internal: false }] })).toBeNull();
    expect(hardwareIdOf({})).toBeNull();
  });
  it('MACs diferentes dão hashes diferentes e o MAC em si não aparece', () => {
    const a = hardwareIdOf({ eth0: [eth] });
    const b = hardwareIdOf({ eth0: [wifi] });
    expect(a).not.toBe(b);
    expect(a).not.toContain('aa:bb');
  });
});

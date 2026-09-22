import { el, esc } from '../dom';
import type { Socket } from '../socket';

type FleetRouter = { id: string; label?: string; host?: string; disabled?: boolean };

type FleetResult = {
  routerId?: string;
  routerName?: string;
  code?: string;
  latest?: string;
  rebooting?: boolean;
  ok?: boolean;
};

function resultText(result: FleetResult): string {
  if (result.ok) return result.rebooting ? 'Rebooting' : 'Upgrade started';
  switch (result.code) {
    case 'nothing-to-update': return 'Already current';
    case 'denied': return 'No write permission';
    case 'router-write-policy': return 'RouterOS write policy missing';
    case 'unavailable': return 'Unavailable';
    case 'failed': return 'Upgrade failed';
    default: return result.code || 'Waiting';
  }
}

export function initFleetUpgradePage(socket: Socket, pageVisible: (name: string) => boolean): void {
  let routers: FleetRouter[] = [];
  let busy = false;
  const selected = new Set<string>();

  const rows = (): HTMLElement | null => el('fleetUpgradeRows');
  const status = (): HTMLElement | null => el('fleetUpgradeStatus');

  function updateButton(): void {
    const button = el<HTMLButtonElement>('fleetUpgradeBtn');
    const confirm = el<HTMLInputElement>('fleetUpgradeConfirm');
    if (button) button.disabled = busy || selected.size === 0 || confirm?.value.trim().toUpperCase() !== 'UPGRADE';
  }

  function render(): void {
    const target = rows();
    if (!target) return;
    const usable = routers.filter((r) => !r.disabled);
    const badge = el('fleetUpgradeBadge');
    if (badge) badge.textContent = String(usable.length);
    if (!routers.length) {
      target.innerHTML = '<tr><td colspan="5" class="empty-state">No registered routers.</td></tr>';
      updateButton();
      return;
    }
    target.innerHTML = routers.map((r) => {
      const disabled = !!r.disabled;
      const result = disabled ? 'Disabled' : (selected.has(r.id) ? 'Selected' : 'Ready');
      return '<tr data-fleet-id="' + esc(r.id) + '"' + (disabled ? ' style="opacity:.58"' : '') + '>'
        + '<td><input type="checkbox" data-fleet-check="' + esc(r.id) + '"'
        + (selected.has(r.id) ? ' checked' : '') + (disabled ? ' disabled' : '') + ' /></td>'
        + '<td><strong>' + esc(r.label || r.id) + '</strong></td>'
        + '<td class="text-muted">' + esc(r.host || '-') + '</td>'
        + '<td>' + esc(disabled ? 'Disabled' : 'Registered') + '</td>'
        + '<td data-fleet-result="' + esc(r.id) + '">' + esc(result) + '</td></tr>';
    }).join('');
    updateButton();
  }

  async function load(): Promise<void> {
    try {
      const response = await fetch('/api/routers', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { routers?: FleetRouter[] } | FleetRouter[];
      routers = Array.isArray(body) ? body : (body.routers || []);
      render();
    } catch {
      const target = rows();
      if (target) target.innerHTML = '<tr><td colspan="5" class="empty-state">Could not load registered routers.</td></tr>';
    }
  }

  document.addEventListener('mikrodash:pagechange', () => {
    if (pageVisible('fleet-upgrade')) load();
  });
  socket.on('perms:changed', () => { if (pageVisible('fleet-upgrade')) load(); });
  socket.on('routers:update', (next) => {
    if (!pageVisible('fleet-upgrade')) return;
    routers = next.map((r) => ({ id: r.id, label: r.label, host: r.host, disabled: r.disabled }));
    render();
  });
  socket.on('fleet:upgrade:result', (result) => {
    if (result.routerId) {
      const cell = document.querySelector<HTMLElement>('[data-fleet-result="' + CSS.escape(result.routerId) + '"]');
      if (cell) cell.textContent = resultText(result);
      selected.delete(result.routerId);
      const check = document.querySelector<HTMLInputElement>('[data-fleet-check="' + CSS.escape(result.routerId) + '"]');
      if (check) check.checked = false;
    }
    if (result.code === 'invalid-request' || result.code === 'confirm-mismatch') {
      if (status()) status()!.textContent = 'Type UPGRADE to confirm.';
      busy = false;
    } else if (result.routerId && selected.size === 0) {
      busy = false;
      if (status()) status()!.textContent = 'Batch complete.';
    }
    updateButton();
  });

  document.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-fleet-check]');
    if (!input) return;
    if (input.checked) selected.add(input.dataset.fleetCheck!);
    else selected.delete(input.dataset.fleetCheck!);
    updateButton();
  });
  el('fleetUpgradeConfirm')?.addEventListener('input', updateButton);
  el('fleetSelectAll')?.addEventListener('click', () => {
    const usable = routers.filter((r) => !r.disabled);
    const allSelected = usable.length > 0 && usable.every((r) => selected.has(r.id));
    usable.forEach((r) => allSelected ? selected.delete(r.id) : selected.add(r.id));
    render();
  });
  el('fleetUpgradeBtn')?.addEventListener('click', () => {
    const confirm = el<HTMLInputElement>('fleetUpgradeConfirm');
    if (busy || !confirm || confirm.value.trim().toUpperCase() !== 'UPGRADE' || !selected.size) return;
    busy = true;
    if (status()) status()!.textContent = 'Checking and upgrading selected routers...';
    socket.emit('fleet:upgrade', { routerIds: [...selected], confirm: 'UPGRADE' });
    updateButton();
  });

  load();
}

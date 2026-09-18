#!/usr/bin/env bash
# Isolated session/polkit subject capture. Not production. No host policy changes.
set -euo pipefail

ACTIONS=(
  org.freedesktop.Flatpak.app-install
  org.freedesktop.Flatpak.app-update
  org.freedesktop.Flatpak.app-uninstall
  org.freedesktop.Flatpak.runtime-install
  org.freedesktop.Flatpak.runtime-update
  org.freedesktop.Flatpak.runtime-uninstall
  org.freedesktop.Flatpak.modify-repo
)

clip() {
  local text="${1-}"
  local limit="${2:-400}"
  if ((${#text} > limit)); then
    printf '%s\n…[truncated]' "${text:0:limit}"
  else
    printf '%s' "$text"
  fi
}

capture_pid() {
  local pid="$1"
  local label="$2"
  echo
  echo "===== SUBJECT ${label} pid=${pid} ====="
  if [[ ! -d "/proc/${pid}" ]]; then
    echo "missing"
    return
  fi
  echo "comm=$(tr -d '\0' < "/proc/${pid}/comm" 2>/dev/null || true)"
  echo "cmdline=$(clip "$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)" 240)"
  echo "uid_gid=$(awk '/^Uid:/{print "uid="$2" euid="$3} /^Gid:/{print "gid="$2" egid="$3}' "/proc/${pid}/status")"
  echo "groups=$(awk '/^Groups:/{print $0}' "/proc/${pid}/status")"
  echo "ppid=$(awk '/^PPid:/{print $2}' "/proc/${pid}/status")"
  echo "loginuid=$(cat "/proc/${pid}/loginuid" 2>/dev/null || true)"
  echo "sessionid=$(cat "/proc/${pid}/sessionid" 2>/dev/null || true)"
  echo "cgroup=$(tr '\n' '|' < "/proc/${pid}/cgroup" 2>/dev/null || true)"
  local sid
  sid="$(loginctl -p Session --value show-process "$pid" 2>/dev/null || true)"
  echo "loginctl_session=${sid}"
  if [[ -n "${sid}" && "${sid}" != "" ]]; then
    loginctl show-session "$sid" -p Id -p Name -p UID -p User -p Seat -p Display -p Remote -p Type -p Class -p Desktop -p Active -p State -p TTY 2>/dev/null || true
  else
    echo "loginctl_session=none"
  fi
  # Environment of interest only
  python3 - "$pid" <<'PY'
import os, sys
pid = sys.argv[1]
keys = (
    "XDG_SESSION_ID", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "XDG_SESSION_CLASS",
    "XDG_SEAT", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY",
    "XDG_CURRENT_DESKTOP", "DESKTOP_SESSION",
)
path = f"/proc/{pid}/environ"
try:
    raw = open(path, "rb").read().split(b"\0")
except OSError as exc:
    print(f"environ_error={exc}")
    raise SystemExit
env = {}
for item in raw:
    if not item or b"=" not in item:
        continue
    k, _, v = item.partition(b"=")
    try:
        env[k.decode()] = v.decode("utf-8", "replace")
    except Exception:
        continue
for key in keys:
    if key in env:
        print(f"env.{key}={env[key]}")
PY
  for action in "${ACTIONS[@]}"; do
    set +e
    out="$(pkcheck --action-id "$action" --process "$pid" 2>&1)"
    rc=$?
    set -e
    echo "pkcheck ${action} rc=${rc} out=$(clip "$out" 200)"
  done
}

echo "host=$(hostname) time=$(date --iso-8601=seconds)"
echo "os=$(grep PRETTY_NAME /etc/os-release)"
echo "variant=$(grep VARIANT_ID /etc/os-release)"
echo "ostree=$(grep OSTREE_VERSION /etc/os-release || true)"
echo "flatpak=$(flatpak --version)"
echo "self_pid=$$"

echo
echo "===== loginctl sessions ====="
loginctl list-sessions --no-pager
echo
for s in $(loginctl list-sessions --no-legend | awk '{print $1}'); do
  echo "--- session $s ---"
  loginctl show-session "$s" -p Id -p Name -p UID -p User -p Seat -p Display -p Remote -p Type -p Class -p Desktop -p Active -p State -p TTY -p Leader
done

echo
echo "===== polkit agents ====="
ps -eo pid,user,comm,args | rg -i 'polkit|policykit' | rg -v 'rg -i' || true

echo
echo "===== plugin_loader ====="
systemctl show plugin_loader.service -p MainPID -p FragmentPath -p User -p UID -p Group -p SupplementaryGroups -p PAMName -p Id -p ActiveState -p FragmentPath -p ControlGroup --no-pager

LOADER="$(systemctl show -p MainPID --value plugin_loader.service)"
DECKY="$(pgrep -n -f '/home/zany130/homebrew/plugins/DeckDepot/main.py' || true)"
PLASMA="$(pgrep -n -x startplasma-wayland || true)"
GAMESCOPE="$(pgrep -n -x gamescope || true)"
STEAM="$(pgrep -n -x steam || true)"
KONSOLE="$(pgrep -n -x konsole || true)"

capture_pid "$$" "cursor-agent-shell"
[[ -n "$PLASMA" ]] && capture_pid "$PLASMA" "startplasma-wayland"
[[ -n "$KONSOLE" ]] && capture_pid "$KONSOLE" "konsole"
[[ -n "$LOADER" && "$LOADER" != 0 ]] && capture_pid "$LOADER" "plugin-loader"
[[ -n "$DECKY" ]] && capture_pid "$DECKY" "deckdepot-backend"
[[ -n "$GAMESCOPE" ]] && capture_pid "$GAMESCOPE" "gamescope"
[[ -n "$STEAM" ]] && capture_pid "$STEAM" "steam"

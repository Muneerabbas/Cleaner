#!/usr/bin/env python3
"""Comprehensive Python conversion of Arch-Essentials shell scripts.

Targets scripts under shell_scripts/Arch-Essentials/scripts and provides
one unified CLI with safe defaults and graceful degradation.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pwd
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_target_home() -> Path:
    if os.geteuid() == 0 and os.environ.get("SUDO_USER"):
        try:
            return Path(pwd.getpwnam(os.environ["SUDO_USER"]).pw_dir)
        except Exception:
            pass
    return Path.home()


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def with_sudo(cmd: list[str], sudo: bool) -> list[str]:
    if sudo and os.geteuid() != 0:
        return ["sudo", *cmd]
    return cmd


def run_cmd(
    cmd: list[str],
    *,
    sudo: bool = False,
    check: bool = False,
    capture: bool = True,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            with_sudo(cmd, sudo),
            check=check,
            text=True,
            capture_output=capture,
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(cmd, 127, "", f"command not found: {cmd[0]}")
    except Exception as exc:  # pylint: disable=broad-except
        return subprocess.CompletedProcess(cmd, 1, "", str(exc))


def run_shell(command: str, *, sudo: bool = False, check: bool = False) -> subprocess.CompletedProcess[str]:
    if sudo and os.geteuid() != 0:
        command = "sudo " + command
    try:
        return subprocess.run(command, shell=True, check=check, text=True, capture_output=True)
    except Exception as exc:  # pylint: disable=broad-except
        return subprocess.CompletedProcess(command, 1, "", str(exc))


def ask_yes_no(question: str, *, default_yes: bool = True, assume_yes: bool = False) -> bool:
    if assume_yes:
        return True
    prompt = "[Y/n]" if default_yes else "[y/N]"
    raw = input(f"{question} {prompt}: ").strip().lower()
    if not raw:
        return default_yes
    return raw in {"y", "yes"}


def write_report(path: Path, lines: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_cmd(cp: subprocess.CompletedProcess[str]) -> None:
    if cp.stdout:
        print(cp.stdout.strip())
    if cp.stderr:
        print(cp.stderr.strip())


def dir_size_human(path: str) -> str:
    cp = run_cmd(["du", "-sh", path])
    if cp.returncode != 0:
        return "N/A"
    parts = (cp.stdout or "").strip().split()
    return parts[0] if parts else "N/A"


def _require_cmd(name: str) -> int:
    if command_exists(name):
        return 0
    print(f"Required command not found: {name}")
    return 1


# ----------------------- Existing conversions (maintenance) ---------------- #


def check_logs(args: argparse.Namespace) -> int:
    report = Path(args.report or (get_target_home() / "check_logs_report.txt"))
    lines = [f"Timestamp: {now()}", "", "=== journalctl errors ==="]
    j = run_cmd(["journalctl", "-p", "err", "-n", str(args.lines)])
    lines.append((j.stdout or "").strip())
    lines.append("")
    lines.append("=== dmesg tail ===")
    d = run_shell(f"dmesg | tail -n {int(args.lines)}")
    lines.append((d.stdout or "").strip())
    write_report(report, lines)
    print(f"Report saved: {report}")
    return 0


def clean_pacman_cache_simple(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    cp = run_cmd(["pacman", "-Sc"], sudo=True)
    print_cmd(cp)
    return cp.returncode


def clear_pacman_cache(args: argparse.Namespace) -> int:
    if _require_cmd("paccache"):
        return 1
    before = dir_size_human("/var/cache/pacman/pkg")
    print(f"Pacman cache before: {before}")
    if not ask_yes_no("Proceed with paccache cleanup?", assume_yes=args.yes):
        return 0
    cp = run_cmd(["paccache", "-r", "-k", str(args.keep)], sudo=True)
    print_cmd(cp)
    print(f"Pacman cache after: {dir_size_human('/var/cache/pacman/pkg')}")
    return cp.returncode


def clear_system_logs(args: argparse.Namespace) -> int:
    if _require_cmd("journalctl"):
        return 1
    before = run_cmd(["journalctl", "--disk-usage"]) 
    print((before.stdout or "").strip())
    if not ask_yes_no(f"Vacuum logs older than {args.vacuum_time}?", assume_yes=args.yes):
        return 0
    cp = run_cmd(["journalctl", f"--vacuum-time={args.vacuum_time}"], sudo=True)
    print_cmd(cp)
    after = run_cmd(["journalctl", "--disk-usage"])
    print((after.stdout or "").strip())
    return cp.returncode


def clear_temp_files(args: argparse.Namespace) -> int:
    print(f"/tmp before: {dir_size_human('/tmp')}")
    print(f"/var/tmp before: {dir_size_human('/var/tmp')}")
    if not ask_yes_no("Clear /tmp and /var/tmp contents?", assume_yes=args.yes):
        return 0
    c1 = run_shell("find /tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} +", sudo=True)
    c2 = run_shell("find /var/tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} +", sudo=True)
    print_cmd(c1)
    print_cmd(c2)
    print(f"/tmp after: {dir_size_human('/tmp')}")
    print(f"/var/tmp after: {dir_size_human('/var/tmp')}")
    return 0 if c1.returncode == 0 and c2.returncode == 0 else 1


def list_orphaned_packages(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    cp = run_cmd(["pacman", "-Qdtq"])
    pkgs = [x.strip() for x in (cp.stdout or "").splitlines() if x.strip()]
    if not pkgs:
        print("No orphaned packages found.")
        return 0
    print(f"Orphaned packages: {len(pkgs)}")
    print("\n".join(sorted(pkgs)))
    return 0


def remove_orphaned_packages(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    cp = run_cmd(["pacman", "-Qdtq"])
    pkgs = [x.strip() for x in (cp.stdout or "").splitlines() if x.strip()]
    if not pkgs:
        print("No orphaned packages found.")
        return 0
    print("Orphan packages:")
    print("\n".join(pkgs))
    if not ask_yes_no("Remove orphan packages?", assume_yes=args.yes):
        return 0
    rm = run_cmd(["pacman", "-Rns", "--noconfirm", *pkgs], sudo=True)
    print_cmd(rm)
    return rm.returncode


def find_broken_packages(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    report = Path(args.report or (get_target_home() / "broken_packages_report.txt"))
    qk = run_shell("pacman -Qk 2>&1")
    broken = sorted({line.split()[0] for line in (qk.stdout or "").splitlines() if line.strip() and "0 missing files" not in line})
    lines = [f"Timestamp: {now()}"]
    if not broken:
        print("No broken packages found.")
        lines.append("No broken packages found.")
        write_report(report, lines)
        return 0
    print("Broken packages:")
    print("\n".join(broken))
    lines.extend(broken)
    if args.reinstall and ask_yes_no("Reinstall broken packages?", assume_yes=args.yes):
        cp = run_cmd(["pacman", "-S", "--needed", *broken], sudo=True)
        print_cmd(cp)
        lines.append(f"Reinstall rc={cp.returncode}")
    write_report(report, lines)
    print(f"Report: {report}")
    return 0


def list_installed_packages(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    official = run_cmd(["pacman", "-Qn"]).stdout.splitlines()
    aur = run_cmd(["pacman", "-Qm"]).stdout.splitlines()
    orphan = run_cmd(["pacman", "-Qdtq"]).stdout.splitlines()
    total = run_cmd(["pacman", "-Q"]).stdout.splitlines()

    print(f"Official packages: {len([x for x in official if x.strip()])}")
    print(f"AUR/foreign packages: {len([x for x in aur if x.strip()])}")
    print(f"Orphaned packages: {len([x for x in orphan if x.strip()])}")
    print(f"Total installed packages: {len([x for x in total if x.strip()])}")

    if args.verbose:
        print("\nOfficial:")
        print("\n".join(sorted([x for x in official if x.strip()])))
        print("\nAUR:")
        print("\n".join(sorted([x for x in aur if x.strip()])))
    return 0


def list_system_packages(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    cp = run_cmd(["pacman", "-Qnq"])
    pkgs = sorted([x.strip() for x in (cp.stdout or "").splitlines() if x.strip()])
    print(f"System package count: {len(pkgs)}")
    print("\n".join(pkgs))
    return 0


def list_aur_packages(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    cp = run_cmd(["pacman", "-Qm"])
    pkgs = sorted([x.strip() for x in (cp.stdout or "").splitlines() if x.strip()])
    print(f"AUR/foreign package count: {len(pkgs)}")
    print("\n".join(pkgs))
    if args.remove:
        helper = "yay" if command_exists("yay") else "paru" if command_exists("paru") else None
        if not helper:
            print("No AUR helper (yay/paru) found.")
            return 1
        rm = run_cmd([helper, "-Rns", args.remove, "--noconfirm"], sudo=True)
        print_cmd(rm)
        return rm.returncode
    return 0


def install_package(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    query = args.name
    res = run_cmd(["pacman", "-Ss", query])
    print("\n".join((res.stdout or "").splitlines()[:30]))

    if args.source == "search-only":
        return 0

    if not args.package:
        print("--package is required for install source official/aur")
        return 1

    run_cmd(["pacman", "-Sy", "--needed", "archlinux-keyring", "--noconfirm"], sudo=True)

    if args.source == "official":
        cp = run_cmd(["pacman", "-S", args.package, "--noconfirm"], sudo=True)
        print_cmd(cp)
        return cp.returncode

    helper = "yay" if command_exists("yay") else "paru" if command_exists("paru") else "pikaur" if command_exists("pikaur") else None
    if not helper:
        print("No AUR helper found (yay/paru/pikaur).")
        return 1
    cp = run_cmd([helper, "-S", args.package, "--noconfirm"])
    print_cmd(cp)
    return cp.returncode


def system_update(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    log = get_target_home() / ".arch_tools_logs" / "system_update.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"[{now()}] system update start"]

    for cmd in [
        ["pacman", "-Sy", "--needed", "archlinux-keyring"],
        ["pacman", "-Syu", "--noconfirm"],
        ["pacman-key", "--populate", "archlinux"],
    ]:
        cp = run_cmd(cmd, sudo=True)
        lines.append(f"$ {' '.join(cmd)} rc={cp.returncode}")
        lines.extend((cp.stdout or "").splitlines())
        lines.extend((cp.stderr or "").splitlines())
        if cp.returncode != 0:
            break

    write_report(log, lines)
    print(f"Log: {log}")
    return 0


def update(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    run_cmd(["pacman-key", "--init"], sudo=True)
    run_cmd(["pacman-key", "--populate"], sudo=True)
    cp = run_cmd(["pacman", "-Syu", "--noconfirm"], sudo=True)
    print_cmd(cp)
    return cp.returncode


def upgrade_packages(_: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    run_cmd(["pacman-key", "--init"], sudo=True)
    run_cmd(["pacman-key", "--populate"], sudo=True)
    ref = run_cmd(["pacman", "-Syy", "--noconfirm"], sudo=True)
    print_cmd(ref)
    if ref.returncode != 0:
        return ref.returncode
    up = run_cmd(["pacman", "-Su", "--noconfirm"], sudo=True)
    print_cmd(up)
    return up.returncode


def test_internet_connection(args: argparse.Namespace) -> int:
    ok = False
    for s in args.servers:
        cp = run_cmd(["ping", "-c", str(args.count), s])
        if cp.returncode == 0:
            print(f"OK: {s}")
            ok = True
        else:
            print(f"FAIL: {s}")
    return 0 if ok else 1


def show_ip_address(_: argparse.Namespace) -> int:
    cp = run_shell("hostname -I | awk '{print $1}'")
    ip = (cp.stdout or "").strip()
    if not ip:
        cp = run_shell("ip addr show | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d '/' -f1 | head -n 1")
        ip = (cp.stdout or "").strip()
    if ip:
        print(ip)
        return 0
    print("Could not determine IP address")
    return 1


def network_speed(args: argparse.Namespace) -> int:
    if not command_exists("speedtest-cli"):
        print("speedtest-cli not installed.")
        if not args.install_missing:
            return 1
        if ask_yes_no("Install speedtest-cli?", assume_yes=args.yes):
            run_cmd(["pacman-key", "--refresh-keys"], sudo=True)
            inst = run_cmd(["pacman", "-S", "--noconfirm", "speedtest-cli"], sudo=True)
            print_cmd(inst)
            if inst.returncode != 0:
                return inst.returncode
        else:
            return 1
    cp = run_cmd(["speedtest-cli", "--simple"])
    print_cmd(cp)
    return cp.returncode


def network_overview(args: argparse.Namespace) -> int:
    summary: dict[str, str] = {}
    summary["internet_status"] = "Working" if run_cmd(["ping", "-c", "2", "8.8.8.8"]).returncode == 0 else "Not Working"
    summary["ip_address"] = (run_shell("hostname -I | awk '{print $1}'").stdout or "").strip() or "Unknown"
    summary["default_gateway"] = (run_shell("ip route | grep default | awk '{print $3}'").stdout or "").strip() or "Unknown"
    if command_exists("nmcli"):
        summary["connection_type"] = ((run_shell("nmcli -t -f DEVICE,TYPE connection show --active | awk -F: '{print $2}'").stdout or "").strip().splitlines() or ["Unknown"])[0]
    else:
        summary["connection_type"] = "nmcli not installed"

    p = run_cmd(["ping", "-c", "4", "8.8.8.8"])
    comb = (p.stdout or "") + "\n" + (p.stderr or "")
    lm = re.search(r"=\s*[\d.]+/([\d.]+)/", comb)
    pm = re.search(r"([\d.]+)%\s+packet loss", comb)
    summary["avg_latency_ms"] = lm.group(1) if lm else "Unknown"
    summary["packet_loss_percent"] = pm.group(1) if pm else "Unknown"

    if command_exists("dig"):
        summary["dns_lookup_google"] = (run_cmd(["dig", "+short", "google.com"]).stdout or "").strip() or "Failed"
    else:
        summary["dns_lookup_google"] = "dig not installed"

    if command_exists("curl"):
        summary["http_status"] = (run_cmd(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "https://www.google.com"]).stdout or "").strip() or "Unknown"
    else:
        summary["http_status"] = "curl not installed"

    if args.gather_stats:
        out = Path(args.stats_file)
        lines: list[str] = []
        for cmd in ["ip -s link", "ip route", "netstat -tunlp"]:
            lines.append(f"$ {cmd}")
            cp = run_shell(cmd)
            lines.append((cp.stdout or "").strip())
            if cp.stderr:
                lines.append(cp.stderr.strip())
            lines.append("")
        write_report(out, lines)
        print(f"Saved stats: {out}")

    print(json.dumps(summary, indent=2))
    return 0


def show_system_specs(_: argparse.Namespace) -> int:
    cmds = [
        "hostname",
        "cat /etc/os-release | grep PRETTY_NAME",
        "uname -r",
        "lscpu | grep -E 'Model name|Socket|Core|Thread|Flags'",
        "free -h | awk '/Mem:/ {print \"Total: \" $2 \", Used: \" $3 \", Free: \" $4}'",
        "df -h --output=source,size,used,avail,pcent",
        "lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT",
        "ip -br addr show",
        "lspci | grep -i vga",
        "lspci -k | grep -A 3 VGA | grep 'Kernel driver'",
    ]
    for c in cmds:
        print(f"\n$ {c}")
        cp = run_shell(c)
        print_cmd(cp)
    return 0


def system_overview(_: argparse.Namespace) -> int:
    cmds = [
        "hostname",
        "uname -o",
        "uname -r",
        "lscpu | grep 'Model name' | cut -d: -f2 | xargs",
        "free -h | awk '/Mem:/ {print \"Total: \" $2 \", Used: \" $3 \", Free: \" $4}'",
        "df -h --output=source,size,used,avail,pcent | head -n 5",
        "ip -br addr show",
        "pacman -Qe | wc -l",
        "uptime -p",
        "checkupdates 2>/dev/null | wc -l",
        "journalctl -p 3 -b --no-pager | tail -n 3",
    ]
    for c in cmds:
        print(f"\n$ {c}")
        cp = run_shell(c)
        print_cmd(cp)
    return 0


def clear_thumbnail_cache(args: argparse.Namespace) -> int:
    d = get_target_home() / ".cache" / "thumbnails"
    if not d.exists():
        print(f"No directory: {d}")
        return 0
    print(f"Before: {dir_size_human(str(d))}")
    if not ask_yes_no("Clear thumbnail cache?", assume_yes=args.yes):
        return 0
    for c in d.iterdir():
        try:
            shutil.rmtree(c) if c.is_dir() else c.unlink(missing_ok=True)
        except Exception as exc:
            print(f"Failed to remove {c}: {exc}")
    print(f"After: {dir_size_human(str(d))}")
    return 0


def clear_user_cache(args: argparse.Namespace) -> int:
    d = get_target_home() / ".cache"
    if not d.exists():
        print(f"No directory: {d}")
        return 0
    print(f"Before: {dir_size_human(str(d))}")
    if not ask_yes_no(f"Clear all contents in {d}?", assume_yes=args.yes):
        return 0
    for c in d.iterdir():
        try:
            shutil.rmtree(c) if c.is_dir() else c.unlink(missing_ok=True)
        except Exception as exc:
            print(f"Failed to remove {c}: {exc}")
    print(f"After: {dir_size_human(str(d))}")
    return 0


def clear_aur_cache(args: argparse.Namespace) -> int:
    if not command_exists("yay"):
        print("yay not installed; skipping.")
        return 0
    if not ask_yes_no("Clear yay cache?", assume_yes=args.yes):
        return 0
    cp = run_cmd(["yay", "-Sc", "--noconfirm"])
    print_cmd(cp)
    return cp.returncode


def remove_old_kernels(args: argparse.Namespace) -> int:
    if _require_cmd("pacman"):
        return 1
    current = (run_cmd(["uname", "-r"]).stdout or "").strip().split("-")[0]
    pkg_lines = run_cmd(["pacman", "-Q"]).stdout.splitlines()
    kernels = [line.split()[0] for line in pkg_lines if line.startswith("linux")]
    remove: list[str] = []
    for k in kernels:
        info = run_cmd(["pacman", "-Qi", k]).stdout
        if current and current not in info:
            remove.append(k)
    if not remove:
        print("No old kernel packages found.")
        return 0
    print("Candidates:")
    print("\n".join(remove))
    if not ask_yes_no("Remove old kernels?", default_yes=False, assume_yes=args.yes):
        return 0
    cp = run_cmd(["pacman", "-Rns", "--noconfirm", *remove], sudo=True)
    print_cmd(cp)
    return cp.returncode


def deep_clean(args: argparse.Namespace) -> int:
    print("Deep clean summary:")
    print(f"/tmp: {dir_size_human('/tmp')}")
    print(f"/var/tmp: {dir_size_human('/var/tmp')}")
    print(f"pacman cache: {dir_size_human('/var/cache/pacman/pkg')}")
    if not ask_yes_no("Proceed deep clean?", assume_yes=args.yes):
        return 0
    clear_temp_files(argparse.Namespace(yes=True, report=None))
    clear_pacman_cache(argparse.Namespace(keep=args.keep, yes=True, report=None))
    clear_system_logs(argparse.Namespace(vacuum_time=args.vacuum_time, yes=True, report=None))
    clear_thumbnail_cache(argparse.Namespace(yes=True))
    remove_orphaned_packages(argparse.Namespace(yes=True, report=None))
    if args.remove_old_kernels:
        remove_old_kernels(argparse.Namespace(yes=True))
    clear_aur_cache(argparse.Namespace(yes=True))
    if args.clear_user_cache:
        clear_user_cache(argparse.Namespace(yes=True))
    print("Deep clean complete.")
    return 0


# --------------------------- Missing conversions ---------------------------- #


def _list_dir_names(path: Path) -> list[str]:
    if not path.exists() or not path.is_dir():
        return []
    return sorted([p.name for p in path.iterdir() if p.is_dir()])


def _apply_gsettings(key: str, value: str) -> int:
    if not command_exists("gsettings"):
        print("gsettings not found")
        return 1
    cp = run_cmd(["gsettings", "set", *key.split(), value])
    print_cmd(cp)
    return cp.returncode


def change_cursor_theme(args: argparse.Namespace) -> int:
    themes = _list_dir_names(Path("/usr/share/icons"))
    if not themes:
        print("No cursor themes found in /usr/share/icons")
        return 1
    if args.list:
        print("\n".join(themes))
        return 0
    theme = args.theme or input("Enter cursor theme name: ").strip()
    if theme not in themes:
        print(f"Theme not found: {theme}")
        return 1
    return _apply_gsettings("org.gnome.desktop.interface cursor-theme", theme)


def change_gtk_theme(args: argparse.Namespace) -> int:
    system = _list_dir_names(Path("/usr/share/themes"))
    user = _list_dir_names(Path.home() / ".themes")
    themes = sorted(set(system + user))
    if not themes:
        print("No GTK themes found")
        return 1
    if args.list:
        print("\n".join(themes))
        return 0
    theme = args.theme or input("Enter GTK theme name: ").strip()
    if theme not in themes:
        print(f"Theme not found: {theme}")
        return 1
    return _apply_gsettings("org.gnome.desktop.interface gtk-theme", theme)


def change_icon_theme(args: argparse.Namespace) -> int:
    themes = _list_dir_names(Path("/usr/share/icons"))
    if not themes:
        print("No icon themes found")
        return 1
    if args.list:
        print("\n".join(themes))
        return 0
    theme = args.theme or input("Enter icon theme name: ").strip()
    if theme not in themes:
        print(f"Theme not found: {theme}")
        return 1
    if args.preview and command_exists("xdg-open"):
        base = Path("/usr/share/icons") / theme
        candidates = list(base.glob("48x48/places/*folder*")) + list(base.glob("32x32/places/*folder*")) + list(base.glob("scalable/places/*folder*"))
        if candidates:
            run_cmd(["xdg-open", str(candidates[0])], capture=False)
        else:
            print("No preview icon found")
    if not ask_yes_no(f"Apply icon theme '{theme}'?", assume_yes=args.yes):
        return 0
    return _apply_gsettings("org.gnome.desktop.interface icon-theme", theme)


def change_grub_theme(args: argparse.Namespace) -> int:
    if _require_cmd("grub-mkconfig"):
        return 1
    themes_dir = Path("/boot/grub/themes")
    themes = _list_dir_names(themes_dir)
    if not themes:
        print(f"No GRUB themes found in {themes_dir}")
        return 1
    if args.list:
        print("\n".join(themes))
        return 0
    theme = args.theme or input("Enter GRUB theme name: ").strip()
    if theme not in themes:
        print(f"Theme not found: {theme}")
        return 1
    if not ask_yes_no(f"Apply GRUB theme '{theme}'?", assume_yes=args.yes):
        return 0
    theme_txt = themes_dir / theme / "theme.txt"
    sed = run_shell(
        f"sed -i 's|^GRUB_THEME=.*|GRUB_THEME=\"{theme_txt}\"|' /etc/default/grub",
        sudo=True,
    )
    mk = run_cmd(["grub-mkconfig", "-o", "/boot/grub/grub.cfg"], sudo=True)
    print_cmd(sed)
    print_cmd(mk)
    return 0 if sed.returncode == 0 and mk.returncode == 0 else 1


def change_plymouth_theme(args: argparse.Namespace) -> int:
    if _require_cmd("plymouth-set-default-theme"):
        return 1
    list_cp = run_cmd(["plymouth-set-default-theme", "--list"])
    themes = [x.strip() for x in (list_cp.stdout or "").splitlines() if x.strip()]
    if not themes:
        print("No plymouth themes found")
        return 1
    if args.list:
        print("\n".join(themes))
        return 0
    theme = args.theme or input("Enter plymouth theme name: ").strip()
    if theme not in themes:
        print(f"Theme not found: {theme}")
        return 1
    if not ask_yes_no(f"Apply plymouth theme '{theme}'?", assume_yes=args.yes):
        return 0
    set_cp = run_cmd(["plymouth-set-default-theme", theme], sudo=True)
    print_cmd(set_cp)
    if set_cp.returncode != 0:
        return set_cp.returncode

    distro = ""
    osrel = Path("/etc/os-release")
    if osrel.exists():
        txt = osrel.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"^ID=(.+)$", txt, re.MULTILINE)
        if m:
            distro = m.group(1).strip().strip('"').lower()

    if distro in {"arch", "manjaro"} and command_exists("mkinitcpio"):
        cp = run_cmd(["mkinitcpio", "-P"], sudo=True)
    elif distro in {"ubuntu", "debian", "pop", "linuxmint"} and command_exists("update-initramfs"):
        cp = run_cmd(["update-initramfs", "-u"], sudo=True)
    elif distro in {"fedora", "rhel", "centos"} and command_exists("dracut"):
        cp = run_cmd(["dracut", "--force"], sudo=True)
    else:
        print("Unsupported distro/initramfs tool; theme set but initramfs not updated.")
        return 0

    print_cmd(cp)
    return cp.returncode


def customize_terminal_colors(args: argparse.Namespace) -> int:
    schemes = {
        "Solarized Dark": {
            "palette": '["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]',
            "bg": "'#002b36'",
            "fg": "'#839496'",
        },
        "Dracula": {
            "palette": '["#282a36", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"]',
            "bg": "'#282a36'",
            "fg": "'#f8f8f2'",
        },
        "Gruvbox Dark": {
            "palette": '["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984", "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"]',
            "bg": "'#282828'",
            "fg": "'#a89984'",
        },
    }

    if _require_cmd("dconf"):
        return 1

    if args.list:
        print("\n".join(schemes.keys()))
        return 0

    scheme = args.scheme or input("Enter scheme name: ").strip()
    if scheme not in schemes:
        print(f"Unknown scheme: {scheme}")
        return 1

    profile = run_shell("gsettings get org.gnome.Terminal.Legacy.ProfilesList default | tr -d " + '"\'' + "").stdout.strip()
    if not profile:
        print("Could not detect default GNOME Terminal profile")
        return 1

    ppath = f"/org/gnome/terminal/legacy/profiles:/:{profile}/"
    cp1 = run_cmd(["dconf", "write", f"{ppath}use-theme-colors", "false"])
    cp2 = run_cmd(["dconf", "write", f"{ppath}palette", schemes[scheme]["palette"]])
    cp3 = run_cmd(["dconf", "write", f"{ppath}background-color", schemes[scheme]["bg"]])
    cp4 = run_cmd(["dconf", "write", f"{ppath}foreground-color", schemes[scheme]["fg"]])
    for cp in (cp1, cp2, cp3, cp4):
        print_cmd(cp)
    return 0 if all(cp.returncode == 0 for cp in (cp1, cp2, cp3, cp4)) else 1


def install_fonts(args: argparse.Namespace) -> int:
    if _require_cmd("fc-list"):
        return 1
    fonts = sorted(set((run_shell("fc-list : family | sort -u").stdout or "").splitlines()))
    fonts = [f.strip() for f in fonts if f.strip()]
    if not fonts:
        print("No fonts found.")
        return 1
    if args.list:
        print("\n".join(fonts))
        return 0
    font = args.font or input("Enter font name to apply: ").strip()
    match = next((f for f in fonts if font.lower() in f.lower()), None)
    if not match:
        print(f"Font not found: {font}")
        return 1
    cp1 = run_cmd(["gsettings", "set", "org.gnome.desktop.interface", "monospace-font-name", match])
    cp2 = run_cmd(["gsettings", "set", "org.gnome.desktop.interface", "font-name", match])
    print_cmd(cp1)
    print_cmd(cp2)
    return 0 if cp1.returncode == 0 and cp2.returncode == 0 else 1


def manage_startup_apps(args: argparse.Namespace) -> int:
    autostart = Path.home() / ".config" / "autostart"
    autostart.mkdir(parents=True, exist_ok=True)

    def desktop_files() -> list[Path]:
        return sorted([p for p in autostart.glob("*.desktop") if p.is_file()])

    if args.action == "list":
        files = desktop_files()
        if not files:
            print("No user startup apps found.")
            return 0
        for f in files:
            txt = f.read_text(encoding="utf-8", errors="ignore")
            name = re.search(r"^Name=(.*)$", txt, re.MULTILINE)
            enabled = re.search(r"^X-GNOME-Autostart-enabled=(.*)$", txt, re.MULTILINE)
            print(f"{f.name}: name={name.group(1) if name else 'N/A'} enabled={enabled.group(1) if enabled else 'true'}")
        return 0

    if args.action == "add":
        if not args.name or not args.exec_cmd:
            print("--name and --exec-cmd required for add")
            return 1
        file = autostart / f"{args.name.replace(' ', '_')}.desktop"
        lines = [
            "[Desktop Entry]",
            "Type=Application",
            f"Name={args.name}",
            f"Exec={args.exec_cmd}",
            "Terminal=false",
            "X-GNOME-Autostart-enabled=true",
        ]
        if args.comment:
            lines.append(f"Comment={args.comment}")
        file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        file.chmod(0o644)
        print(f"Added startup entry: {file}")
        return 0

    if args.action in {"remove", "toggle"}:
        if not args.name:
            print("--name required")
            return 1
        file = autostart / f"{args.name.replace(' ', '_')}.desktop"
        if not file.exists():
            print(f"Startup app not found: {file}")
            return 1
        if args.action == "remove":
            file.unlink(missing_ok=True)
            print(f"Removed startup entry: {file}")
            return 0

        txt = file.read_text(encoding="utf-8", errors="ignore")
        if "X-GNOME-Autostart-enabled=false" in txt:
            txt = txt.replace("X-GNOME-Autostart-enabled=false", "X-GNOME-Autostart-enabled=true")
            state = "enabled"
        elif "X-GNOME-Autostart-enabled=true" in txt:
            txt = txt.replace("X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false")
            state = "disabled"
        else:
            txt += "\nX-GNOME-Autostart-enabled=false\n"
            state = "disabled"
        file.write_text(txt, encoding="utf-8")
        print(f"Toggled startup entry: {file} -> {state}")
        return 0

    print(f"Unknown action: {args.action}")
    return 1


def manage_system_sounds(args: argparse.Namespace) -> int:
    if _require_cmd("gsettings"):
        return 1

    if args.action == "enable":
        cp = run_cmd(["gsettings", "set", "org.gnome.desktop.sound", "event-sounds", "true"])
        print_cmd(cp)
        return cp.returncode

    if args.action == "mute":
        cp = run_cmd(["gsettings", "set", "org.gnome.desktop.sound", "event-sounds", "false"])
        print_cmd(cp)
        return cp.returncode

    if args.action == "customize-startup":
        if not args.sound_file:
            print("--sound-file required")
            return 1
        source = Path(args.sound_file).expanduser().resolve()
        if not source.exists():
            print(f"Sound file not found: {source}")
            return 1
        target = Path("/usr/share/sounds/freedesktop/stereo/desktop-login.oga")
        backup = Path.home() / ".local" / "share" / "sounds" / "desktop-login-backup.oga"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not backup.exists():
            cp = run_cmd(["cp", str(target), str(backup)], sudo=True)
            print_cmd(cp)
        cp2 = run_cmd(["cp", str(source), str(target)], sudo=True)
        print_cmd(cp2)
        return cp2.returncode

    print(f"Unknown action: {args.action}")
    return 1


def set_dynamic_wallpaper(args: argparse.Namespace) -> int:
    home = get_target_home()
    repo_url = "https://github.com/adi1090x/dynamic-wallpaper.git"
    repo_dir = home / ".local" / "share" / "dynamic-wallpaper"
    log_file = home / ".dynamic-wallpaper.log"

    def log(msg: str) -> None:
        with log_file.open("a", encoding="utf-8") as f:
            f.write(f"[{now()}] {msg}\n")

    if args.status:
        print(f"repo_dir={repo_dir} exists={repo_dir.exists()}")
        print(f"log_file={log_file}")
        return 0

    if args.apply_wallpaper:
        wp = Path(args.apply_wallpaper).expanduser().resolve()
        if not wp.exists():
            print(f"Wallpaper not found: {wp}")
            return 1
        if os.environ.get("XDG_SESSION_TYPE") == "wayland":
            c1 = run_cmd(["gsettings", "set", "org.gnome.desktop.background", "picture-uri", f"file://{wp}"])
            c2 = run_cmd(["gsettings", "set", "org.gnome.desktop.background", "picture-uri-dark", f"file://{wp}"])
            print_cmd(c1)
            print_cmd(c2)
            return 0 if c1.returncode == 0 and c2.returncode == 0 else 1
        c1 = run_cmd(["gsettings", "set", "org.gnome.desktop.background", "picture-uri", f"file://{wp}"])
        print_cmd(c1)
        if command_exists("feh"):
            c2 = run_cmd(["feh", "--bg-scale", str(wp)])
            print_cmd(c2)
            return 0 if c1.returncode == 0 and c2.returncode == 0 else 1
        return c1.returncode

    if not args.install:
        print("Use --install, --status, or --apply-wallpaper")
        return 0

    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    if repo_dir.exists() and not (repo_dir / ".git").exists():
        if ask_yes_no("Repository folder looks invalid. Recreate?", assume_yes=args.yes):
            shutil.rmtree(repo_dir)

    if not repo_dir.exists():
        if not ask_yes_no("Clone dynamic-wallpaper repository (~1GB)?", assume_yes=args.yes):
            return 0
        cp = run_cmd(["git", "clone", repo_url, str(repo_dir)])
        print_cmd(cp)
        log(f"clone rc={cp.returncode}")
        if cp.returncode != 0:
            return cp.returncode

    if args.enable_auto:
        change_script = home / ".local" / "bin" / "change-wallpaper"
        change_script.parent.mkdir(parents=True, exist_ok=True)
        change_script.write_text(
            "#!/bin/bash\n"
            "WALLPAPER_DIR=\"$HOME/.local/share/dynamic-wallpaper/wallpapers\"\n"
            "WALLPAPER=$(find \"$WALLPAPER_DIR\" -type f \\( -name '*.jpg' -o -name '*.png' \\) | shuf -n 1)\n"
            "if [ \"$XDG_SESSION_TYPE\" = \"wayland\" ]; then\n"
            "  gsettings set org.gnome.desktop.background picture-uri \"file://$WALLPAPER\"\n"
            "  gsettings set org.gnome.desktop.background picture-uri-dark \"file://$WALLPAPER\"\n"
            "else\n"
            "  gsettings set org.gnome.desktop.background picture-uri \"file://$WALLPAPER\"\n"
            "  feh --bg-scale \"$WALLPAPER\"\n"
            "fi\n",
            encoding="utf-8",
        )
        change_script.chmod(0o755)
        cron = run_shell(f"(crontab -l 2>/dev/null; echo '0 * * * * {change_script}') | crontab -")
        print_cmd(cron)
        log(f"enable_auto rc={cron.returncode}")
        return cron.returncode

    print(f"Repository ready: {repo_dir}")
    log("repository ready")
    return 0


def deep_debug(args: argparse.Namespace) -> int:
    report = Path(args.report or (get_target_home() / "debug_report.txt"))
    lines: list[str] = [f"Timestamp: {now()}", "Deep Debug Report"]

    checks = {
        "kernel_os": ["uname", "-a"],
        "os_release": ["sh", "-lc", "lsb_release -a 2>/dev/null || cat /etc/os-release"],
        "cpu": ["lscpu"],
        "memory": ["free", "-h"],
        "disk": ["lsblk", "-o", "NAME,SIZE,FSTYPE,MOUNTPOINT"],
        "network": ["ip", "-br", "link", "show"],
        "services": ["systemctl", "--failed", "--no-legend"],
        "journal_errors": ["journalctl", "-p", "err", "-n", "50"],
        "gpu": ["sh", "-lc", "nvidia-smi 2>/dev/null || lspci | grep -i vga"],
        "usb": ["sh", "-lc", "lsusb 2>/dev/null || true"],
    }

    summary_issues: list[str] = []
    for name, cmd in checks.items():
        lines.append(f"\n=== {name} ===")
        cp = run_cmd(cmd)
        out = (cp.stdout or "").strip()
        err = (cp.stderr or "").strip()
        lines.append(out)
        if err:
            lines.append(err)
        if cp.returncode != 0 and name not in {"gpu", "usb"}:
            summary_issues.append(f"{name} check failed")

    if command_exists("pacman"):
        orphans = run_cmd(["pacman", "-Qdtq"])
        if (orphans.stdout or "").strip():
            summary_issues.append("orphan packages detected")
            lines.append("\n=== orphan_packages ===")
            lines.append((orphans.stdout or "").strip())

        broken = run_shell("pacman -Qk 2>&1 | grep -v ' 0 missing files' || true")
        if (broken.stdout or "").strip():
            summary_issues.append("broken package files detected")
            lines.append("\n=== broken_packages ===")
            lines.append((broken.stdout or "").strip())

    lines.append("\n=== summary ===")
    if summary_issues:
        lines.extend([f"- {x}" for x in summary_issues])
    else:
        lines.append("No major issues detected.")

    write_report(report, lines)
    print(f"Deep debug report written to {report}")
    return 0


def yay_install(args: argparse.Namespace) -> int:
    if os.geteuid() == 0:
        print("Do not run yay-install as root.")
        return 1
    if _require_cmd("pacman") or _require_cmd("git"):
        return 1

    dep = run_cmd(["pacman", "-S", "--needed", "--noconfirm", "git", "base-devel"], sudo=True)
    print_cmd(dep)
    if dep.returncode != 0:
        return dep.returncode

    with tempfile.TemporaryDirectory(prefix="yay-build-") as td:
        clone = run_cmd(["git", "clone", "https://aur.archlinux.org/yay.git", td])
        print_cmd(clone)
        if clone.returncode != 0:
            return clone.returncode
        build = subprocess.run(["makepkg", "-si", "--noconfirm", "--needed"], cwd=td, text=True, capture_output=True)
        print_cmd(build)
        return build.returncode


def arch_menu(_: argparse.Namespace) -> int:
    print("Arch Essentials Python Menu")
    print("Use subcommands instead of interactive fzf menu.")
    print("Run: arch_essentials_converted.py --help")
    return 0


# ------------------------------- Parser ------------------------------------- #


def _add_yes(p: argparse.ArgumentParser) -> None:
    p.add_argument("--yes", action="store_true", help="Assume yes for prompts")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="arch_essentials_converted", description="Python conversion of Arch-Essentials shell scripts")
    sub = p.add_subparsers(dest="command", required=True)

    # Existing
    x = sub.add_parser("check-logs")
    x.add_argument("--report")
    x.add_argument("--lines", type=int, default=50)
    x.set_defaults(func=check_logs)

    x = sub.add_parser("clean-pacman-cache")
    x.set_defaults(func=clean_pacman_cache_simple)

    x = sub.add_parser("clear-pacman-cache")
    x.add_argument("--keep", type=int, default=2)
    x.add_argument("--report")
    _add_yes(x)
    x.set_defaults(func=clear_pacman_cache)

    x = sub.add_parser("clear-system-logs")
    x.add_argument("--vacuum-time", default="7d")
    x.add_argument("--report")
    _add_yes(x)
    x.set_defaults(func=clear_system_logs)

    x = sub.add_parser("clear-temp-files")
    x.add_argument("--report")
    _add_yes(x)
    x.set_defaults(func=clear_temp_files)

    x = sub.add_parser("deep-clean")
    x.add_argument("--vacuum-time", default="7d")
    x.add_argument("--keep", type=int, default=2)
    x.add_argument("--clear-user-cache", action="store_true")
    x.add_argument("--remove-old-kernels", action="store_true")
    _add_yes(x)
    x.set_defaults(func=deep_clean)

    x = sub.add_parser("find-broken-packages")
    x.add_argument("--report")
    x.add_argument("--reinstall", action="store_true")
    _add_yes(x)
    x.set_defaults(func=find_broken_packages)

    x = sub.add_parser("list-orphaned-packages")
    x.set_defaults(func=list_orphaned_packages)

    x = sub.add_parser("remove-orphaned-packages")
    x.add_argument("--report")
    _add_yes(x)
    x.set_defaults(func=remove_orphaned_packages)

    x = sub.add_parser("list-installed-packages")
    x.add_argument("--verbose", action="store_true")
    x.set_defaults(func=list_installed_packages)

    x = sub.add_parser("list-system-packages")
    x.set_defaults(func=list_system_packages)

    x = sub.add_parser("list-aur-packages")
    x.add_argument("--remove")
    x.set_defaults(func=list_aur_packages)

    x = sub.add_parser("install-package")
    x.add_argument("name")
    x.add_argument("--source", choices=["official", "aur", "search-only"], default="search-only")
    x.add_argument("--package")
    x.set_defaults(func=install_package)

    x = sub.add_parser("system-update")
    x.set_defaults(func=system_update)

    x = sub.add_parser("update")
    x.set_defaults(func=update)

    x = sub.add_parser("upgrade-packages")
    x.set_defaults(func=upgrade_packages)

    x = sub.add_parser("test-internet-connection")
    x.add_argument("--servers", nargs="+", default=["8.8.8.8", "1.1.1.1", "8.8.4.4"])
    x.add_argument("--count", type=int, default=4)
    x.set_defaults(func=test_internet_connection)

    x = sub.add_parser("show-ip-address")
    x.set_defaults(func=show_ip_address)

    x = sub.add_parser("network-speed")
    x.add_argument("--install-missing", action="store_true")
    _add_yes(x)
    x.set_defaults(func=network_speed)

    x = sub.add_parser("network-overview")
    x.add_argument("--gather-stats", action="store_true")
    x.add_argument("--stats-file", default="/tmp/network_stats.txt")
    x.set_defaults(func=network_overview)

    x = sub.add_parser("show-system-specs")
    x.set_defaults(func=show_system_specs)

    x = sub.add_parser("system-overview")
    x.set_defaults(func=system_overview)

    x = sub.add_parser("clear-thumbnail-cache")
    _add_yes(x)
    x.set_defaults(func=clear_thumbnail_cache)

    x = sub.add_parser("clear-user-cache")
    _add_yes(x)
    x.set_defaults(func=clear_user_cache)

    x = sub.add_parser("clear-aur-cache")
    _add_yes(x)
    x.set_defaults(func=clear_aur_cache)

    x = sub.add_parser("remove-old-kernels")
    _add_yes(x)
    x.set_defaults(func=remove_old_kernels)

    # Missing conversions added
    x = sub.add_parser("change-cursor-theme")
    x.add_argument("--theme")
    x.add_argument("--list", action="store_true")
    x.set_defaults(func=change_cursor_theme)

    x = sub.add_parser("change-gtk-theme")
    x.add_argument("--theme")
    x.add_argument("--list", action="store_true")
    x.set_defaults(func=change_gtk_theme)

    x = sub.add_parser("change-icon-theme")
    x.add_argument("--theme")
    x.add_argument("--list", action="store_true")
    x.add_argument("--preview", action="store_true")
    _add_yes(x)
    x.set_defaults(func=change_icon_theme)

    x = sub.add_parser("change-grub-theme")
    x.add_argument("--theme")
    x.add_argument("--list", action="store_true")
    _add_yes(x)
    x.set_defaults(func=change_grub_theme)

    x = sub.add_parser("change-plymouth-theme")
    x.add_argument("--theme")
    x.add_argument("--list", action="store_true")
    _add_yes(x)
    x.set_defaults(func=change_plymouth_theme)

    x = sub.add_parser("customize-terminal-colors")
    x.add_argument("--scheme")
    x.add_argument("--list", action="store_true")
    x.set_defaults(func=customize_terminal_colors)

    x = sub.add_parser("install-fonts")
    x.add_argument("--font")
    x.add_argument("--list", action="store_true")
    x.set_defaults(func=install_fonts)

    x = sub.add_parser("manage-startup-apps")
    x.add_argument("--action", choices=["list", "add", "remove", "toggle"], default="list")
    x.add_argument("--name")
    x.add_argument("--exec-cmd")
    x.add_argument("--comment")
    x.set_defaults(func=manage_startup_apps)

    x = sub.add_parser("manage-system-sounds")
    x.add_argument("--action", choices=["enable", "mute", "customize-startup"], default="enable")
    x.add_argument("--sound-file")
    x.set_defaults(func=manage_system_sounds)

    x = sub.add_parser("set-dynamic-wallpaper")
    x.add_argument("--install", action="store_true")
    x.add_argument("--enable-auto", action="store_true")
    x.add_argument("--status", action="store_true")
    x.add_argument("--apply-wallpaper")
    _add_yes(x)
    x.set_defaults(func=set_dynamic_wallpaper)

    x = sub.add_parser("deep-debug")
    x.add_argument("--report")
    x.set_defaults(func=deep_debug)

    x = sub.add_parser("yay-install")
    _add_yes(x)
    x.set_defaults(func=yay_install)

    x = sub.add_parser("menu")
    x.set_defaults(func=arch_menu)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

# Shell to Python Conversion Map

Converted from `shell_scripts/Arch-Essentials/scripts` into `python_scripts`.

## Core converted engine
- `python_scripts/arch_essentials_converted.py`

You can run any function through this script with subcommands, for example:
```bash
python3 python_scripts/arch_essentials_converted.py clear-temp-files --yes
python3 python_scripts/arch_essentials_converted.py deep-clean --yes --remove-old-kernels
```

## Wrapper scripts (direct replacements)
- `check_logs.sh` -> `python_scripts/check_logs.py`
- `clean_package_cache.sh` -> `python_scripts/clean_package_cache.py`
- `clean_pacman_cache.sh` -> `python_scripts/clean_pacman_cache.py`
- `clear_pacman_cache.sh` -> `python_scripts/clear_pacman_cache.py`
- `clear_system_logs.sh` -> `python_scripts/clear_system_logs.py`
- `clear_temp_files.sh` -> `python_scripts/clear_temp_files.py`
- `deep_clean.sh` -> `python_scripts/deep_clean.py`
- `find_broken_packages.sh` -> `python_scripts/find_broken_packages.py`
- `list_orphaned_packages.sh` -> `python_scripts/list_orphaned_packages.py`
- `remove_orphaned_packages.sh` -> `python_scripts/remove_orphaned_packages.py`
- `list_installed_packages.sh` -> `python_scripts/list_installed_packages.py`
- `list_system_packages.sh` -> `python_scripts/list_system_packages.py`
- `list_aur_packages.sh` -> `python_scripts/list_aur_packages.py`
- `install_package.sh` -> `python_scripts/install_package.py`
- `system_update.sh` -> `python_scripts/system_update.py`
- `update.sh` -> `python_scripts/update.py`
- `upgrade_packages.sh` -> `python_scripts/upgrade_packages.py`
- `network_overview.sh` -> `python_scripts/network_overview.py`
- `network_speed.sh` -> `python_scripts/network_speed.py`
- `test_internet_connection.sh` -> `python_scripts/test_internet_connection.py`
- `show_ip_address.sh` -> `python_scripts/show_ip_address.py`
- `show_system_specs.sh` -> `python_scripts/show_system_specs.py`
- `system_overview.sh` -> `python_scripts/system_overview.py`

## Additional cleanup helpers added in Python
- `python_scripts/clear_thumbnail_cache.py`
- `python_scripts/clear_user_cache.py`
- `python_scripts/clear_aur_cache.py`
- `python_scripts/remove_old_kernels.py`

## Notes
- These scripts are primarily Arch/pacman oriented and will fail gracefully on unsupported systems.
- Destructive operations still require confirmation unless `--yes` is provided.
- Commands requiring elevated privileges use `sudo` when needed.

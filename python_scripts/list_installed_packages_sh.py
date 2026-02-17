#!/usr/bin/env python3
"""Compatibility wrapper for list_installed_packages.sh.sh conversion."""

from __future__ import annotations

import sys

import arch_essentials_converted


if __name__ == "__main__":
    sys.exit(arch_essentials_converted.main(["list-installed-packages", *sys.argv[1:]]))

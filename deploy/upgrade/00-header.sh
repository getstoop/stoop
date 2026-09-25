#!/bin/sh
# Upgrades a compose install of Stoop to a newer release, and rolls one
# back. Run it from the directory that holds docker-compose.yml and .env.
# What it does and why: docs/self-hosting.md → Upgrading.
#
# This file is assembled from deploy/upgrade/*.sh in name order by
# `make upgrade-script`; edit the parts, not this file.
set -eu

repo=https://github.com/getstoop/stoop
next=docker-compose.yml.next
prev=docker-compose.yml.prev

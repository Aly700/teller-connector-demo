#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
cd vendor/teller
./mvnw -B -Dmaven.repo.local="$ROOT/.data/m2" -Dmaven.test.skip=true package > "$ROOT/.data/logs/teller-build.log" 2>&1 || { tail -n 70 "$ROOT/.data/logs/teller-build.log"; exit 1; }
tail -n 8 "$ROOT/.data/logs/teller-build.log"

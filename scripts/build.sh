#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."

docker run --rm -it \
    --user "$(id -u):$(id -g)" \
    -v "$PROJECT_ROOT":/work \
    -w /work \
    ecofleet-yocto:dev \
    bash -c "
        source poky/oe-init-build-env build-docker && \
        bitbake ecofleet-image
    "
